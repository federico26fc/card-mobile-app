import { useEffect, useState } from "react";

const IMAGES_STORAGE_KEY = "card-mobile-app-images";
const IMAGES_DATABASE_NAME = "card-mobile-app";
const IMAGES_STORE_NAME = "images";
const NUMBERS = Array.from({ length: 100 }, (_, number) => number);

const getRandomNumber = () => Math.floor(Math.random() * 100);
const formatNumber = (number) => String(number).padStart(2, "0");

const prepareImage = (file) => new Promise((resolve, reject) => {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  image.onload = () => {
    URL.revokeObjectURL(objectUrl);

    const maxSize = 1200;
    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

    const imageUrl = canvas.toDataURL("image/jpeg", 0.76);
    resolve(imageUrl);
  };

  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error("unsupported-format"));
  };

  image.src = objectUrl;
});

const getLegacyStoredImages = () => {
  try {
    const storedImages = localStorage.getItem(IMAGES_STORAGE_KEY);
    return storedImages ? JSON.parse(storedImages) : {};
  } catch {
    return {};
  }
};

const openImagesDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(IMAGES_DATABASE_NAME, 1);

  request.onupgradeneeded = () => {
    request.result.createObjectStore(IMAGES_STORE_NAME, { keyPath: "number" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const loadImages = async () => {
  const database = await openImagesDatabase();
  const images = await new Promise((resolve, reject) => {
    const request = database.transaction(IMAGES_STORE_NAME, "readonly").objectStore(IMAGES_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  database.close();
  return Object.fromEntries(images.map(({ number, imageUrl }) => [number, imageUrl]));
};

const saveImage = async (number, imageUrl) => {
  const database = await openImagesDatabase();

  await new Promise((resolve, reject) => {
    const request = database.transaction(IMAGES_STORE_NAME, "readwrite").objectStore(IMAGES_STORE_NAME).put({ number, imageUrl });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  database.close();
};

function App() {
  const [imagesByNumber, setImagesByNumber] = useState({});
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const [mode, setMode] = useState("random");
  const [numberHistory, setNumberHistory] = useState([getRandomNumber()]);
  const [error, setError] = useState("");
  const displayNumber = numberHistory[numberHistory.length - 1];
  const selectedImage = imagesByNumber[displayNumber] || "";

  useEffect(() => {
    const initialiseImages = async () => {
      try {
        let images = await loadImages();

        if (Object.keys(images).length === 0) {
          const legacyImages = getLegacyStoredImages();
          await Promise.all(Object.entries(legacyImages).map(([number, imageUrl]) => saveImage(Number(number), imageUrl)));
          images = legacyImages;
          localStorage.removeItem(IMAGES_STORAGE_KEY);
        }

        setImagesByNumber(images);
      } catch {
        setError("Non è stato possibile aprire l'archivio immagini.");
      } finally {
        setImagesLoaded(true);
      }
    };

    initialiseImages();
  }, []);

  const onChooseImage = async (number, event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const imageUrl = await prepareImage(file);
      const updatedImages = { ...imagesByNumber, [number]: imageUrl };

      await saveImage(number, imageUrl);
      setImagesByNumber(updatedImages);
      setShowCard(false);
      setError("");
    } catch (imageError) {
      if (imageError.message === "unsupported-format") {
        setError("Questo formato non è supportato. Usa JPG, PNG o WEBP.");
      } else if (imageError.name === "QuotaExceededError") {
        setError("Spazio immagini del dispositivo esaurito.");
      } else {
        setError("Non è stato possibile caricare l'immagine.");
      }
    }
  };

  const openManager = () => {
    setShowCard(false);
    setError("");
    setMode("manage");
  };

  const openRandomMode = () => {
    setShowCard(false);
    setError("");
    setMode("random");
  };

  const onScreenTap = () => {
    if (!selectedImage) {
      setError("Seleziona prima un'immagine.");
      return;
    }

    setShowCard(true);
    setError("");
  };

  const onNextNumber = () => {
    let nextNumber = getRandomNumber();

    while (nextNumber === displayNumber) {
      nextNumber = getRandomNumber();
    }

    setNumberHistory((history) => [...history, nextNumber]);
    setShowCard(false);
    setError("");
  };

  const onPreviousNumber = () => {
    if (numberHistory.length === 1) {
      return;
    }

    setNumberHistory((history) => history.slice(0, -1));
    setShowCard(false);
    setError("");
  };

  return (
    <main
      className={`app ${mode === "manage" ? "manager-app" : ""}`}
      onClick={mode === "random" ? onScreenTap : undefined}
      role={mode === "random" ? "button" : undefined}
      tabIndex={mode === "random" ? 0 : undefined}
      onKeyDown={mode === "random" ? (event) => event.key === "Enter" && onScreenTap() : undefined}
    >
      <button
        type="button"
        className="manager-button"
        onClick={mode === "manage" ? openRandomMode : openManager}
        disabled={!imagesLoaded}
      >
        {mode === "manage" ? "Modalità random" : "Caricamenti immagini"}
      </button>

      {!imagesLoaded && <p className="loading">Caricamento archivio immagini...</p>}

      {imagesLoaded && mode === "manage" && (
        <section className="manager" onClick={(event) => event.stopPropagation()}>
          <div className="manager-heading">
            <p className="label">Archivio immagini</p>
            <h1>Associa ogni immagine al suo numero</h1>
            <p className="hint">Carica o sostituisci l’immagine dei numeri da 00 a 99.</p>
          </div>
          <div className="image-grid">
            {NUMBERS.map((number) => (
              <article className="image-slot" key={number}>
                <div className="slot-preview">
                  {imagesByNumber[number] ? (
                    <img src={imagesByNumber[number]} alt={`Immagine ${formatNumber(number)}`} />
                  ) : (
                    <span>Nessuna immagine</span>
                  )}
                </div>
                <strong>{formatNumber(number)}</strong>
                <input
                  id={`image-${number}`}
                  className="hidden-input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => onChooseImage(number, event)}
                />
                <label className="slot-button" htmlFor={`image-${number}`}>
                  {imagesByNumber[number] ? "Sostituisci" : "Carica"}
                </label>
              </article>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {imagesLoaded && mode === "random" && !showCard && (
        <section className="panel" onClick={(event) => event.stopPropagation()}>
          <p className="label">Numero visibile</p>
          <p className="number">{formatNumber(displayNumber)}</p>
          <p className="hint">Tocca lo schermo per mostrare l’immagine associata</p>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {imagesLoaded && mode === "random" && showCard && selectedImage && (
        <div className="card-layout" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="next-button"
            onClick={onPreviousNumber}
            disabled={numberHistory.length === 1}
            aria-label="Torna al numero precedente"
            title="Torna al numero precedente"
          >
            &lt;
          </button>
          <article className="card">
            <img src={selectedImage} alt={`Immagine ${formatNumber(displayNumber)}`} />
          </article>
          <button
            type="button"
            className="next-button"
            onClick={onNextNumber}
            aria-label="Mostra un altro numero"
            title="Mostra un altro numero"
          >
            &gt;
          </button>
        </div>
      )}
    </main>
  );
}

export default App;
