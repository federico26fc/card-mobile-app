import { useEffect, useRef, useState } from "react";

const IMAGES_STORAGE_KEY = "card-mobile-app-images";
const IMAGES_DATABASE_NAME = "card-mobile-app";
const IMAGES_STORE_NAME = "images";
const NUMBERS = Array.from({ length: 100 }, (_, number) => number);

const getRandomNumber = () => Math.floor(Math.random() * 100);
const formatNumber = (number) => String(number).padStart(2, "0");
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const getSpokenNumber = (number) => formatNumber(number).split("").map((digit) => NUMBER_WORDS[Number(digit)]).join(", ");

const getTenRandomNumbers = () => Array.from({ length: 10 }, getRandomNumber);

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
  const [tenNumbers, setTenNumbers] = useState([]);
  const [tenView, setTenView] = useState("numbers");
  const [tenAnnouncing, setTenAnnouncing] = useState(false);
  const [numberHistory, setNumberHistory] = useState([getRandomNumber()]);
  const [error, setError] = useState("");
  const speechSequenceRef = useRef(0);
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

  useEffect(() => () => {
    speechSequenceRef.current += 1;
    window.speechSynthesis?.cancel();
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

  const stopSpeech = () => {
    speechSequenceRef.current += 1;
    window.speechSynthesis?.cancel();
  };

  const openManager = () => {
    stopSpeech();
    setShowCard(false);
    setError("");
    setMode("manage");
  };

  const openRandomMode = () => {
    stopSpeech();
    setShowCard(false);
    setError("");
    setMode("random");
  };

  const announceTenNumbers = (numbers) => {
    if (!("speechSynthesis" in window)) {
      setTenAnnouncing(false);
      setError("La sintesi vocale non è disponibile su questo dispositivo.");
      return;
    }

    const sequenceId = speechSequenceRef.current + 1;
    speechSequenceRef.current = sequenceId;
    window.speechSynthesis.cancel();
    setTenAnnouncing(true);

    const announceNext = (index) => {
      if (speechSequenceRef.current !== sequenceId) {
        return;
      }

      if (index === numbers.length) {
        setTenAnnouncing(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(getSpokenNumber(numbers[index]));
      utterance.lang = "en-US";
      utterance.rate = 0.85;
      utterance.onend = () => announceNext(index + 1);
      utterance.onerror = () => announceNext(index + 1);
      window.speechSynthesis.speak(utterance);
    };

    announceNext(0);
  };

  const startTenRound = () => {
    const numbers = getTenRandomNumbers();

    stopSpeech();
    setTenNumbers(numbers);
    setTenView("numbers");
    setTenAnnouncing(false);
    setError("");
  };

  const repeatTenNumbers = () => {
    if (tenNumbers.length > 0) {
      announceTenNumbers(tenNumbers);
    }
  };

  const openTenMode = () => {
    setShowCard(false);
    setMode("ten");
    startTenRound();
  };

  const speakNumber = (number) => {
    if (!("speechSynthesis" in window)) {
      setError("La sintesi vocale non è disponibile su questo dispositivo.");
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(getSpokenNumber(number));
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  };

  const onScreenTap = () => {
    if (!selectedImage) {
      setError("Seleziona prima un'immagine.");
      return;
    }

    setShowCard(true);
    speakNumber(displayNumber);
    setError("");
  };

  const onNextNumber = () => {
    let nextNumber = getRandomNumber();

    while (nextNumber === displayNumber) {
      nextNumber = getRandomNumber();
    }

    setNumberHistory((history) => [...history, nextNumber]);
    setShowCard(false);
    speakNumber(nextNumber);
    setError("");
  };

  const onPreviousNumber = () => {
    if (numberHistory.length === 1) {
      return;
    }

    const previousNumber = numberHistory[numberHistory.length - 2];
    setNumberHistory((history) => history.slice(0, -1));
    setShowCard(false);
    speakNumber(previousNumber);
    setError("");
  };

  return (
    <main
      className={`app ${mode === "manage" || mode === "ten" ? "workspace-app" : ""}`}
      onClick={mode === "random" ? onScreenTap : undefined}
      role={mode === "random" ? "button" : undefined}
      tabIndex={mode === "random" ? 0 : undefined}
      onKeyDown={mode === "random" ? (event) => event.key === "Enter" && onScreenTap() : undefined}
    >
      <nav className="mode-controls" aria-label="Modalità applicazione">
        <button type="button" className={mode === "random" ? "active" : ""} onClick={openRandomMode} disabled={!imagesLoaded}>
          Random
        </button>
        <button type="button" className={mode === "ten" ? "active" : ""} onClick={openTenMode} disabled={!imagesLoaded}>
          TEN
        </button>
        <button type="button" className={mode === "manage" ? "active" : ""} onClick={openManager} disabled={!imagesLoaded}>
          Caricamenti immagini
        </button>
      </nav>

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

      {imagesLoaded && mode === "ten" && (
        <section className="ten" onClick={(event) => event.stopPropagation()}>
          <div className="ten-heading">
            <p className="label">Modalità TEN</p>
            <h1>Dieci numeri casuali</h1>
            <p className="hint">{tenAnnouncing ? "Annuncio vocale in corso..." : "Usa “Ripeti numeri” per ascoltare la sequenza."}</p>
          </div>

          {tenView === "numbers" ? (
            <div className="ten-number-grid">
              {tenNumbers.map((number, index) => <span key={`${number}-${index}`}>{formatNumber(number)}</span>)}
            </div>
          ) : (
            <div className="ten-image-grid">
              {tenNumbers.map((number, index) => (
                <article className="ten-image" key={`${number}-${index}`}>
                  <strong>{formatNumber(number)}</strong>
                  {imagesByNumber[number] ? (
                    <img src={imagesByNumber[number]} alt={`Immagine ${formatNumber(number)}`} />
                  ) : (
                    <span>Nessuna immagine associata</span>
                  )}
                </article>
              ))}
            </div>
          )}

          <div className="ten-actions">
            <button type="button" className="ten-button secondary" onClick={startTenRound}>
              Nuovi dieci numeri
            </button>
            <button type="button" className="ten-button secondary" onClick={repeatTenNumbers} disabled={tenAnnouncing}>
              Ripeti numeri
            </button>
            <button
              type="button"
              className="ten-button"
              onClick={() => setTenView((view) => view === "numbers" ? "images" : "numbers")}
              disabled={tenAnnouncing}
            >
              {tenView === "numbers" ? "Scopri immagini" : "Mostra numeri"}
            </button>
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
