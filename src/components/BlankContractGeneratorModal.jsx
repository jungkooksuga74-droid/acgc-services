import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, LoaderCircle, Printer, X } from "lucide-react";
import BlankContractDocument from "@/components/BlankContractDocument";
import { createContractPdfDataUrl } from "@/lib/contractPdf";
import { printContractElement } from "@/lib/printContract";

const MIN_ROWS = 1;
const MAX_ROWS = 30;
const FILE_NAME = "ACGC_Blank_Service_Contract.pdf";

function BlankContractGeneratorModal({ open, onClose, darkMode = false }) {
  const [rowCountInput, setRowCountInput] = useState("5");
  const [previewRowCount, setPreviewRowCount] = useState(5);
  const [pdfUrl, setPdfUrl] = useState("");
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const exportDocumentRef = useRef(null);
  const previewDocumentRef = useRef(null);

  const parsedRowCount = Number(rowCountInput);
  const isValidRowCount = Number.isInteger(parsedRowCount)
    && parsedRowCount >= MIN_ROWS
    && parsedRowCount <= MAX_ROWS;

  const handleClose = useCallback(() => {
    setRowCountInput("5");
    setPreviewRowCount(5);
    setPdfUrl("");
    setError("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!pdfUrl) return undefined;
    return () => URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !isGenerating) handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, isGenerating, open]);

  const handleGenerate = async (event) => {
    event.preventDefault();
    if (!isValidRowCount) {
      setError(`Enter a whole number from ${MIN_ROWS} to ${MAX_ROWS}.`);
      return;
    }

    setError("");
    setIsGenerating(true);
    try {
      const pdfDataUrl = await createContractPdfDataUrl(exportDocumentRef.current);
      const pdfBlob = await (await fetch(pdfDataUrl)).blob();
      setPreviewRowCount(parsedRowCount);
      setPdfUrl(URL.createObjectURL(pdfBlob));
    } catch (generationError) {
      setError(generationError?.message || "Unable to generate the blank contract PDF.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = () => {
    try {
      printContractElement(previewDocumentRef.current);
    } catch (printError) {
      setError(printError?.message || "Unable to open the print dialog.");
    }
  };

  if (!open) return null;

  if (pdfUrl) {
    return (
      <div
        className="contract-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-1.5"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) handleClose();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label={`Blank Service Contract Preview, ${previewRowCount} empty product rows`}
          className="mobile-fullscreen-dialog flex h-[94dvh] max-h-[94dvh] w-[min(100%,960px)] flex-col overflow-hidden rounded-2xl bg-[#e5e5e5] shadow-2xl contract-modal-shell"
        >
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-gray-300 bg-white px-3 py-2 sm:px-4 contract-modal-toolbar">
            <div className="contract-toolbar-heading">
              <h2 className="text-lg font-bold text-black">Service Contract</h2>
            </div>
            <div className="contract-toolbar-actions flex flex-wrap items-center gap-2">
              <div className="contract-toolbar-utility">
                <a
                  href={pdfUrl}
                  download={FILE_NAME}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 hover:bg-gray-100 sm:text-sm inline-flex items-center gap-2"
                >
                  <Download size={15} aria-hidden="true" />
                  Download PDF
                </a>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 hover:bg-gray-100 sm:text-sm inline-flex items-center gap-2"
                >
                  <Printer size={15} aria-hidden="true" />
                  Print Contract
                </button>
              </div>
              <div className="contract-toolbar-controls">
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close blank contract"
                  className="rounded-lg p-1.5 text-gray-700 hover:bg-gray-100"
                >
                  <X size={22} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700">{error}</p>}
          <div className="contract-page-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <BlankContractDocument rowCount={previewRowCount} documentRef={previewDocumentRef} />
          </div>
        </section>
      </div>
    );
  }

  const surfaceClass = darkMode
    ? "border-slate-700 bg-slate-900 text-slate-100"
    : "border-slate-200 bg-white text-slate-900";
  const secondaryButtonClass = darkMode
    ? "border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700"
    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50";

  return (
    <div
      className="mobile-fullscreen-overlay fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isGenerating) handleClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="blank-contract-title"
        className={`mobile-fullscreen-dialog flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-2xl border shadow-2xl ${surfaceClass} max-w-xl`}
      >
        <header className={`flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-slate-800 text-slate-100" : "bg-slate-100 text-slate-800"}`}>
              <FileText size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="blank-contract-title" className="truncate text-base font-bold sm:text-lg">Generate Blank Contract</h2>
              <p className={`mt-0.5 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>ACGC Glass &amp; Aluminum Services</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isGenerating}
            aria-label="Close blank contract generator"
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-50 ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleGenerate} className="flex min-h-0 flex-col">
          <div className="space-y-5 px-5 py-5">
            <p className={`text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
              Create a standalone, printable contract template. It will not use or change any customer, order, or site inspection records.
            </p>
            <div>
              <label htmlFor="blank-contract-row-count" className="block text-sm font-semibold">Number of Product Rows</label>
              <input
                id="blank-contract-row-count"
                type="number"
                inputMode="numeric"
                min={MIN_ROWS}
                max={MAX_ROWS}
                step="1"
                value={rowCountInput}
                disabled={isGenerating}
                onChange={(event) => {
                  setRowCountInput(event.target.value);
                  setError("");
                }}
                aria-describedby="blank-contract-row-count-help blank-contract-row-count-summary"
                aria-invalid={Boolean(error)}
                className={`mt-2 min-h-11 w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-500/20 disabled:opacity-60 ${darkMode ? "border-slate-600 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-900"}`}
              />
              <p id="blank-contract-row-count-help" className={`mt-1.5 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                Choose a whole number from {MIN_ROWS} to {MAX_ROWS}.
              </p>
              <p id="blank-contract-row-count-summary" aria-live="polite" className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${darkMode ? "bg-slate-800 text-slate-200" : "bg-slate-100 text-slate-700"}`}>
                {isValidRowCount
                  ? `${parsedRowCount} empty product ${parsedRowCount === 1 ? "row" : "rows"} will be generated.`
                  : `Enter a whole number from ${MIN_ROWS} to ${MAX_ROWS}.`}
              </p>
              {error && <p role="alert" className="mt-2 text-sm font-medium text-red-600">{error}</p>}
            </div>
          </div>
          <footer className={`flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
            <button type="button" onClick={handleClose} disabled={isGenerating} className={`inline-flex min-h-10 items-center justify-center rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${secondaryButtonClass}`}>
              Cancel
            </button>
            <button type="submit" disabled={isGenerating || !isValidRowCount} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50">
              {isGenerating ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
              {isGenerating ? "Generating..." : "Generate Contract"}
            </button>
          </footer>
        </form>
        <div className="contract-template-export-source" aria-hidden="true">
          <BlankContractDocument
            rowCount={isValidRowCount ? parsedRowCount : 5}
            documentRef={exportDocumentRef}
          />
        </div>
      </section>
    </div>
  );
}

export default BlankContractGeneratorModal;
