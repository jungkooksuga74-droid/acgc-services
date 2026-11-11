import { toJpeg } from "html-to-image";
import jsPDF from "jspdf";

const createContractPrintClone = (element) => {
  const clone = element.cloneNode(true);
  clone.style.width = "794px";
  clone.style.maxWidth = "794px";
  clone.style.boxSizing = "border-box";
  clone.style.height = "auto";
  clone.style.overflow = "visible";
  clone.style.position = "relative";
  clone.style.maxHeight = "none";
  clone.style.backgroundColor = "#fff";
  clone.style.color = "#111";
  clone.style.border = "0";
  clone.style.borderRadius = "0";
  clone.style.boxShadow = "none";

  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-9999px";
  wrapper.style.top = "0";
  wrapper.style.opacity = "0";
  wrapper.style.pointerEvents = "none";
  wrapper.style.zIndex = "-1";
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  return { wrapper, clone };
};

export const createContractPdfDataUrl = async (element) => {
  if (!element) throw new Error("Contract content is not available to export.");

  const { wrapper, clone } = createContractPrintClone(element);
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const exportQualities = [
      { pixelRatio: 2.25, quality: 0.9 },
      { pixelRatio: 1.75, quality: 0.86 },
      { pixelRatio: 1.35, quality: 0.8 },
    ];

    for (const quality of exportQualities) {
      const contractImage = await toJpeg(clone, {
        ...quality,
        backgroundColor: "#ffffff",
      });
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imageProperties = pdf.getImageProperties(contractImage);
      const pageMargin = 28.35;
      const printableWidth = pdfWidth - pageMargin * 2;
      const printableHeight = pdfHeight - pageMargin * 2;
      const imageHeight = (imageProperties.height * printableWidth) / imageProperties.width;
      let heightLeft = imageHeight;
      let position = pageMargin;

      pdf.addImage(contractImage, "JPEG", pageMargin, position, printableWidth, imageHeight);
      heightLeft -= printableHeight;
      while (heightLeft > 0) {
        position -= printableHeight;
        pdf.addPage();
        pdf.addImage(contractImage, "JPEG", pageMargin, position, printableWidth, imageHeight);
        heightLeft -= printableHeight;
      }

      const pdfDataUrl = pdf.output("datauristring");
      if (pdfDataUrl.length <= 12 * 1024 * 1024) return pdfDataUrl;
    }

    throw new Error("The contract PDF is too large to export.");
  } finally {
    wrapper.remove();
  }
};
