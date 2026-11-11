export const printContractElement = (element) => {
  if (!element) throw new Error("Contract content is not available to print.");

  const clone = element.cloneNode(true);
  clone.id = "contract-print-content";
  clone.style.width = "100%";
  clone.style.maxWidth = "860px";
  clone.style.height = "auto";
  clone.style.maxHeight = "none";
  clone.style.overflow = "visible";
  clone.style.position = "relative";
  clone.style.margin = "0 auto";
  clone.style.border = "0";
  clone.style.borderRadius = "0";
  clone.style.boxShadow = "none";

  const printContainer = document.createElement("div");
  printContainer.className = "contract-print-only";
  printContainer.appendChild(clone);
  document.body.appendChild(printContainer);

  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    printContainer.remove();
  };

  window.addEventListener("afterprint", cleanup, { once: true });

  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
};

