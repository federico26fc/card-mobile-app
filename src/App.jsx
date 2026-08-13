import { useRef, useState } from "react";

const INITIAL_NUMBER = 0;
const IMAGES_STORAGE_KEY = "card-mobile-app-images";

const getRandomNumber = () => Math.floor(Math.random() * 100);
const formatNumber = (number) => String(number).padStart(2, "0");

const getStoredImages = () => {
  try {
    const storedImages = localStorage.getItem(IMAGES_STORAGE_KEY);
    return storedImages ? JSON.parse(storedImages) : {};
  } catch {
    return {};
  }
};

function App() {
  const [imagesByNumber, setImagesByNumber] = useState(getStoredImages);
  const [showCard, setShowCard] = useState(false);
  const [numberHistory, setNumberHistory] = useState([INITIAL_NUMBER]);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const displayNumber = numberHistory[numberHistory.length - 1];
  const selectedImage = imagesByNumber[displayNumber] || "";

  const onChooseImage = (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const imageUrl = reader.result;

      if (typeof imageUrl !== "string") {
        setError("Non è stato possibile salvare l'immagine.");
        return;
      }

      const updatedImages = { ...imagesByNumber, [displayNumber]: imageUrl };

      localStorage.setItem(IMAGES_STORAGE_KEY, JSON.stringify(updatedImages));
      setImagesByNumber(updatedImages);
      setShowCard(false);
      setError("");
    };

    reader.onerror = () => {
      setError("Non è stato possibile salvare l'immagine.");
    };

    reader.readAsDataURL(file);
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
    <main className="app" onClick={onScreenTap} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onScreenTap()}>
      {!showCard && (
        <section className="panel" onClick={(e) => e.stopPropagation()}>
          <p className="label">Numero visibile</p>
          <p className="number">{formatNumber(displayNumber)}</p>

          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            onChange={onChooseImage}
          />

          <button
            type="button"
            className="select-button"
            onClick={() => fileInputRef.current?.click()}
          >
            Seleziona immagine
          </button>

          <p className="hint">Tocca lo schermo per mostrare la card</p>

          {error && <p className="error">{error}</p>}
        </section>
      )}

      {showCard && selectedImage && (
        <div className="card-layout" onClick={(e) => e.stopPropagation()}>
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
            <img src={selectedImage} alt="Immagine selezionata" />
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
