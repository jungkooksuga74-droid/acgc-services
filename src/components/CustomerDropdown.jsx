import { Children, isValidElement, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

const getText = (value) => {
  if (Array.isArray(value)) return value.map(getText).join("");
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (isValidElement(value)) return getText(value.props.children);
  return "";
};

export default function CustomerDropdown({ value, onChange, children, className = "", darkMode = false, disabled = false, ariaLabel, ["aria-label"]: ariaLabelAttribute, id, name }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const options = Children.toArray(children).filter((child) => isValidElement(child) && child.type === "option");
  const selectedOption = options.find((option) => String(option.props.value ?? getText(option.props.children)) === String(value ?? ""));

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const desiredHeight = Math.min(240, options.length * 36 + 12);
    const openAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    const availableSpace = openAbove ? spaceAbove : spaceBelow;
    const menuHeight = Math.min(desiredHeight, Math.max(48, availableSpace - 8));
    setMenuStyle({
      position: "fixed",
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      top: openAbove ? Math.max(8, rect.top - menuHeight - 6) : Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 8),
      width: rect.width,
      height: menuHeight,
      maxHeight: menuHeight,
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const closeOutside = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const closeOnKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnKey);
    };
  }, [open, options.length]);

  const menu = open && menuStyle && typeof document !== "undefined" ? createPortal(
    <div ref={menuRef} style={menuStyle} role="listbox" aria-label={ariaLabel || ariaLabelAttribute || "Choose an option"} className={`z-[120] overflow-y-auto rounded-2xl border p-1.5 shadow-xl ${darkMode ? "border-[#3d4862] bg-[#2a3246]" : "border-slate-200 bg-white"}`}>
      {options.map((option, index) => {
        const optionValue = String(option.props.value ?? getText(option.props.children));
        const selected = optionValue === String(value ?? "");
        const optionDisabled = Boolean(option.props.disabled);
        return <button key={option.key || `${optionValue}-${index}`} type="button" role="option" aria-selected={selected} disabled={optionDisabled} onClick={() => { onChange?.({ target: { value: optionValue, name } }); setOpen(false); }} className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${selected ? darkMode ? "bg-red-950/50 font-semibold text-red-200" : "bg-rose-50 font-semibold text-red-700" : darkMode ? "text-[#e8ebf2] hover:bg-[#343e55]" : "text-slate-700 hover:bg-slate-100"}`}>
          <span className="min-w-0 truncate">{option.props.children}</span>
          {selected && <Check size={16} className={`shrink-0 ${darkMode ? "text-red-300" : "text-red-700"}`} aria-hidden="true" />}
        </button>;
      })}
    </div>,
    document.body,
  ) : null;

  return <>
    <button ref={triggerRef} id={id} type="button" role="combobox" aria-label={ariaLabel || ariaLabelAttribute} aria-haspopup="listbox" aria-expanded={open} aria-disabled={disabled} disabled={disabled} onClick={() => { if (!open) updatePosition(); setOpen((current) => !current); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(true); } }} className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-red-400/70 bg-[#2a3246] text-[#e8ebf2] hover:border-red-400 focus-visible:border-red-400" : "border-red-300 bg-white text-slate-700 hover:border-red-400 focus-visible:border-red-400"} ${className}`}>
      <span className="min-w-0 truncate">{selectedOption ? selectedOption.props.children : "Select an option"}</span>
      <ChevronDown size={16} aria-hidden="true" className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
    {menu}
  </>;
}
