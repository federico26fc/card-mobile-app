import { useEffect, useRef, useState } from "react";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

const IMAGES_STORAGE_KEY = "card-mobile-app-images";
const SPEECH_RATE_STORAGE_KEY = "card-mobile-app-speech-rate";
const TEN_NO_PAUSE_STORAGE_KEY = "card-mobile-app-ten-no-pause";
const TEN_SPEECH_DELAY_STORAGE_KEY = "card-mobile-app-ten-speech-delay";
const TEN_LENGTH_MODE_STORAGE_KEY = "card-mobile-app-ten-length-mode";
const IMAGES_DATABASE_NAME = "card-mobile-app";
const IMAGES_STORE_NAME = "images";
const NUMBERS = Array.from({ length: 100 }, (_, number) => number);

const getRandomNumber = () => Math.floor(Math.random() * 100);
const formatNumber = (number) => String(number).padStart(2, "0");
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const getSpokenNumber = (number) => formatNumber(number).split("").map((digit) => NUMBER_WORDS[Number(digit)]).join(", ");
const getSpeechPause = (rate, additionalDelay) => Math.max(25, Math.round(350 / rate) + additionalDelay);

const getTenRandomNumbers = (length) => Array.from({ length }, getRandomNumber);

const getStoredSpeechRate = () => {
  const storedRate = Number(localStorage.getItem(SPEECH_RATE_STORAGE_KEY));
  return storedRate >= 0.5 && storedRate <= 5 ? storedRate : 0.85;
};

const getStoredTenNoPause = () => localStorage.getItem(TEN_NO_PAUSE_STORAGE_KEY) === "true";
const getStoredTenSpeechDelay = () => {
  const storedDelay = Number(localStorage.getItem(TEN_SPEECH_DELAY_STORAGE_KEY));
  return storedDelay >= 0 && storedDelay <= 5000 ? storedDelay : 0;
};
const getStoredTenLengthMode = () => localStorage.getItem(TEN_LENGTH_MODE_STORAGE_KEY) === "random" ? "random" : "fixed";

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

const replaceImages = async (imagesByNumber) => {
  const database = await openImagesDatabase();

  await new Promise((resolve, reject) => {
    const store = database.transaction(IMAGES_STORE_NAME, "readwrite").objectStore(IMAGES_STORE_NAME);
    const clearRequest = store.clear();

    clearRequest.onerror = () => reject(clearRequest.error);
    clearRequest.onsuccess = () => {
      Object.entries(imagesByNumber).forEach(([number, imageUrl]) => {
        store.put({ number: Number(number), imageUrl });
      });
    };

    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
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
  const [tenNumbersHidden, setTenNumbersHidden] = useState(false);
  const [tenRecallInput, setTenRecallInput] = useState("");
  const [tenReverseInput, setTenReverseInput] = useState(false);
  const [tenScore, setTenScore] = useState(null);
  const [tenRecallResults, setTenRecallResults] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [speechRate, setSpeechRate] = useState(getStoredSpeechRate);
  const [tenNoPause, setTenNoPause] = useState(getStoredTenNoPause);
  const [tenSpeechDelay, setTenSpeechDelay] = useState(getStoredTenSpeechDelay);
  const [tenLengthMode, setTenLengthMode] = useState(getStoredTenLengthMode);
  const [numberHistory, setNumberHistory] = useState([getRandomNumber()]);
  const [error, setError] = useState("");
  const speechSequenceRef = useRef(0);
  const hasAnnouncedInitialRandomRef = useRef(false);
  const backupInputRef = useRef(null);
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
    TextToSpeech.stop().catch(() => {});
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
    TextToSpeech.stop().catch(() => {});
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
    speakNumber(displayNumber);
  };

  const announceTenNumbers = (numbers) => {
    const sequenceId = speechSequenceRef.current + 1;
    speechSequenceRef.current = sequenceId;
    TextToSpeech.stop().catch(() => {});
    setTenAnnouncing(true);

    if (tenNoPause) {
      TextToSpeech.speak({ text: numbers.map(getSpokenNumber).join(", "), lang: "en-US", rate: speechRate })
        .then(() => {
        if (speechSequenceRef.current === sequenceId) {
          setTenAnnouncing(false);
          setTenNumbersHidden(true);
        }
        })
        .catch(() => {
          if (speechSequenceRef.current === sequenceId) {
            setTenAnnouncing(false);
            setTenNumbersHidden(true);
            setError("La sintesi vocale non è disponibile su questo dispositivo.");
          }
        });
      return;
    }

    const announceNext = async (index) => {
      if (speechSequenceRef.current !== sequenceId) {
        return;
      }

      if (index === numbers.length) {
        setTenAnnouncing(false);
        setTenNumbersHidden(true);
        return;
      }

      try {
        await TextToSpeech.speak({ text: getSpokenNumber(numbers[index]), lang: "en-US", rate: speechRate });
      } catch {
        if (speechSequenceRef.current === sequenceId) {
          setTenAnnouncing(false);
          setTenNumbersHidden(true);
          setError("La sintesi vocale non è disponibile su questo dispositivo.");
        }
        return;
      }

      if (speechSequenceRef.current === sequenceId) {
        setTimeout(() => announceNext(index + 1), getSpeechPause(speechRate, tenSpeechDelay));
      }
    };

    announceNext(0);
  };

  const startTenRound = (announceNumbers = false) => {
    const length = tenLengthMode === "random" ? 5 + Math.floor(Math.random() * 6) : 10;
    const numbers = getTenRandomNumbers(length);
    
    stopSpeech();
    setTenNumbers(numbers);
    setTenView("numbers");
    setTenAnnouncing(false);
    setTenNumbersHidden(false);
    setTenRecallInput("");
    setTenReverseInput(false);
    setTenScore(null);
    setTenRecallResults([]);
    setError("");

    if (announceNumbers) {
      announceTenNumbers(numbers);
    }
  };

  const repeatTenNumbers = () => {
    if (tenNumbers.length > 0) {
      announceTenNumbers(tenNumbers);
    }
  };

  const onTenRecall = () => {
    if (tenNumbers.length === 0) {
      return;
    }

    const input = tenRecallInput.trim();
    const compactInput = input.replace(/\s+/g, "");
    const inputTokens = compactInput.length % 2 === 0
      ? compactInput.match(/.{2}/g) || []
      : [];
    const isValidInput = inputTokens.length >= 1
      && inputTokens.length <= tenNumbers.length
      && inputTokens.every((token) => /^[0-9*]{2}$/.test(token));

    if (!isValidInput) {
      setTenRecallResults([]);
      setError(`Inserisci da 1 a ${tenNumbers.length} coppie di due caratteri; usa **, *3 o 3* per le cifre dimenticate. Es.: 12 ** *3 44`);
      return;
    }

    const normalizedNumbers = tenReverseInput
      ? inputTokens.map((value) => {
        const digits = value.split("");
        return digits.reverse().join("");
      }).reverse()
      : inputTokens;

    const expectedDigits = tenNumbers
      .slice(0, normalizedNumbers.length)
      .flatMap((number) => formatNumber(number).split(""));
    const actualDigits = normalizedNumbers.flatMap((value) => value.split(""));
    const results = expectedDigits.map((expectedDigit, index) => ({
      expectedDigit,
      actualDigit: actualDigits[index] ?? "",
      isCorrect: actualDigits[index] === expectedDigit,
      isUnknown: actualDigits[index] === "*",
    }));

    const correctCount = results.filter(({ isCorrect }) => isCorrect).length;
    const knownDigitCount = results.filter(({ isUnknown }) => !isUnknown).length;
    setTenScore({ correctCount, total: knownDigitCount });
    setTenRecallResults(results);
    setError("");
  };

  const openTenMode = () => {
    setShowCard(false);
    setMode("ten");
    startTenRound(true);
  };

  const speakNumber = (number) => {
    TextToSpeech.speak({ text: getSpokenNumber(number), lang: "en-US", rate: speechRate }).catch(() => {
      setError("La sintesi vocale non è disponibile su questo dispositivo.");
    });
  };

  const onSpeechRateChange = (event) => {
    const nextRate = Number(event.target.value);

    setSpeechRate(nextRate);
    localStorage.setItem(SPEECH_RATE_STORAGE_KEY, String(nextRate));
  };

  const onTenNoPauseChange = (event) => {
    const noPause = event.target.checked;

    setTenNoPause(noPause);
    localStorage.setItem(TEN_NO_PAUSE_STORAGE_KEY, String(noPause));
  };

  const onTenSpeechDelayChange = (event) => {
    const nextDelay = Number(event.target.value);

    setTenSpeechDelay(nextDelay);
    localStorage.setItem(TEN_SPEECH_DELAY_STORAGE_KEY, String(nextDelay));
  };

  const onTenLengthModeChange = (event) => {
    const nextMode = event.target.value;

    setTenLengthMode(nextMode);
    localStorage.setItem(TEN_LENGTH_MODE_STORAGE_KEY, nextMode);
  };

  const exportImages = () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      imagesByNumber,
    };
    const backupUrl = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
    const downloadLink = document.createElement("a");

    downloadLink.href = backupUrl;
    downloadLink.download = "card-mobile-app-images-backup.json";
    downloadLink.click();
    URL.revokeObjectURL(backupUrl);
  };

  const importImages = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const backup = JSON.parse(await file.text());
      const importedImages = backup?.imagesByNumber;

      if (!importedImages || typeof importedImages !== "object" || Array.isArray(importedImages)) {
        throw new Error("invalid-backup");
      }

      const validImages = Object.fromEntries(
        Object.entries(importedImages).filter(([number, imageUrl]) => Number.isInteger(Number(number))
          && Number(number) >= 0
          && Number(number) <= 99
          && typeof imageUrl === "string"
          && imageUrl.startsWith("data:image/"))
      );

      if (Object.keys(validImages).length === 0 && Object.keys(importedImages).length > 0) {
        throw new Error("invalid-backup");
      }

      await replaceImages(validImages);
      setImagesByNumber(validImages);
      setError("");
    } catch {
      setError("Il file di backup non è valido o non può essere importato.");
    } finally {
      event.target.value = "";
    }
  };

  useEffect(() => {
    if (!imagesLoaded || hasAnnouncedInitialRandomRef.current) {
      return;
    }

    hasAnnouncedInitialRandomRef.current = true;
    speakNumber(displayNumber);
  }, [imagesLoaded]);

  const onScreenTap = () => {
    if (!selectedImage) {
      setError("Seleziona prima un'immagine.");
      return;
    }

    stopSpeech();
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
    speakNumber(nextNumber);
    setError("");
  };

  const onReturnToNumber = () => {
    setShowCard(false);
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
      <div className="top-controls" onClick={(event) => event.stopPropagation()}>
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
        <button
          type="button"
          className="settings-button"
          onClick={() => setShowSettings((visible) => !visible)}
          aria-expanded={showSettings}
          aria-controls="speech-settings"
          aria-label="Impostazioni"
          title="Impostazioni"
        >
          ⚙
        </button>
        {showSettings && (
          <section id="speech-settings" className="settings-panel">
            <label htmlFor="speech-rate">Velocità voce: {speechRate.toFixed(2)}x</label>
            <input
              id="speech-rate"
              type="range"
              min="0.5"
              max="5"
              step="0.05"
              value={speechRate}
              onChange={onSpeechRateChange}
            />
            <label className="settings-toggle" htmlFor="ten-no-pause">
              <input
                id="ten-no-pause"
                type="checkbox"
                checked={tenNoPause}
                onChange={onTenNoPauseChange}
              />
              Nessuna pausa tra i numeri TEN
            </label>
            <label htmlFor="ten-speech-delay">Pausa aggiuntiva: {(tenSpeechDelay / 1000).toFixed(1)} s</label>
            <input
              id="ten-speech-delay"
              type="range"
              min="0"
              max="5000"
              step="100"
              value={tenSpeechDelay}
              onChange={onTenSpeechDelayChange}
            />
            <label htmlFor="ten-length-mode">Quantità numeri TEN</label>
            <select id="ten-length-mode" value={tenLengthMode} onChange={onTenLengthModeChange}>
              <option value="fixed">Sempre 10 coppie (20 cifre)</option>
              <option value="random">Casuale da 10 a 20 numeri</option>
            </select>
            <div className="backup-actions">
              <button type="button" onClick={exportImages}>
                Esporta immagini
              </button>
              <input
                ref={backupInputRef}
                id="images-backup"
                className="hidden-input"
                type="file"
                accept="application/json,.json"
                onChange={importImages}
              />
              <label htmlFor="images-backup">Importa immagini</label>
            </div>
            <button type="button" onClick={() => speakNumber(displayNumber)}>
              Prova voce
            </button>
          </section>
        )}
      </div>

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
            <p className="hint">{tenAnnouncing ? "Annuncio vocale in corso..." : `Sequenza di ${tenNumbers.length} numeri. Usa “Ripeti numeri” per ascoltarla.`}</p>
          </div>

          {tenView === "numbers" ? (
            <div className={`ten-number-grid ${tenNumbersHidden ? "ten-number-grid-hidden" : ""}`}>
              {tenNumbers.map((number, index) => (
                <span key={`${number}-${index}`}>
                  {tenNumbersHidden ? "?" : formatNumber(number)}
                </span>
              ))}
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
            {tenNumbers.length > 0 && (
              <button
                type="button"
                className="ten-button secondary"
                onClick={() => setTenNumbersHidden((hidden) => !hidden)}
                disabled={tenAnnouncing}
              >
                {tenNumbersHidden ? "Mostra numeri" : "Nascondi numeri"}
              </button>
            )}
          </div>

          <div className="ten-recall">
            <div className="ten-recall-header">
              <label htmlFor="ten-recall-input">Numeri ricordati (da 1 a {tenNumbers.length})</label>
              <label className="ten-recall-reverse" htmlFor="ten-reverse-input">
                <input
                  id="ten-reverse-input"
                  type="checkbox"
                  checked={tenReverseInput}
                  onChange={(event) => setTenReverseInput(event.target.checked)}
                />
                <span>Contrario</span>
              </label>
            </div>
            <input
              id="ten-recall-input"
              type="text"
              value={tenRecallInput}
              onChange={(event) => setTenRecallInput(event.target.value)}
              placeholder="es. 12 ** *3 44"
              disabled={tenNumbers.length === 0}
            />
            <button type="button" className="ten-button" onClick={onTenRecall} disabled={tenNumbers.length === 0}>
              Controlla
            </button>
            {tenScore && (
              <>
                <p className="ten-score" aria-live="polite">
                  Hai fatto {tenScore.correctCount}/{tenScore.total} numeri giusti.
                </p>
                <div className="ten-recall-results" aria-live="polite">
                  {tenRecallResults.map(({ expectedDigit, actualDigit, isCorrect, isUnknown }, index) => (
                    <span
                      key={`${expectedDigit}-${index}`}
                      className={isUnknown ? "unknown-digit" : isCorrect ? "correct-digit" : "wrong-digit"}
                      title={`Previsto: ${expectedDigit} • Inserito: ${actualDigit || "-"}`}
                    >
                      {actualDigit || expectedDigit}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {error && <p className="error">{error}</p>}
        </section>
      )}

      {imagesLoaded && mode === "random" && !showCard && (
        <section className="panel" onClick={(event) => event.stopPropagation()}>
          <p className="label">Numero visibile</p>
          <p className="number">{formatNumber(displayNumber)}</p>
          <button type="button" className="repeat-number-button" onClick={() => speakNumber(displayNumber)}>
            Ripeti numero
          </button>
          <p className="hint">Tocca lo schermo per mostrare l’immagine associata</p>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {imagesLoaded && mode === "random" && showCard && selectedImage && (
        <div className="card-layout" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="next-button back-button"
            onClick={onReturnToNumber}
            aria-label="Torna al numero associato all'immagine"
            title="Torna al numero associato all'immagine"
          >
            &lt;
          </button>
          <article className="card">
            <img src={selectedImage} alt={`Immagine ${formatNumber(displayNumber)}`} />
          </article>
          <button
            type="button"
            className="next-button forward-button"
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
