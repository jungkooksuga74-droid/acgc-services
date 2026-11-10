import CustomerDropdown from "@/components/CustomerDropdown";
import { useEffect, useRef, useState } from "react";
import {
  Package,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  Star,
  Check,
} from "lucide-react";
import toast from "react-hot-toast";
import AppToaster from "@/components/AppToaster";
import * as catalogApi from '@/api/catalog';
import { API_BASE } from "@/api/client";
import { uploadFiles } from "@/api/uploads";

import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import FilterDropdown from "@/components/FilterDropdown";
import { calculateEstimate, toSquareFeet } from "../../lib/estimator";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import {
  getProducts,
  createProduct as createProductApi,
  updateProduct as updateProductApi,
  deleteProduct as deleteProductApi,
} from "@/api/products";
import { recordActivity } from "@/lib/activityLog";
import { useIsMobile } from "@/hooks/useIsMobile";
import { resolveBackendImageUrl } from "@/lib/resolveBackendImageUrl";
import { getBladePriceOverrideRate, getDefaultExtraChargeSelections, getDefaultProductLineTotal, getProductLineTotal } from "@/lib/productPricing";
import UnsavedChangesDialog from "@/components/UnsavedChangesDialog";
import { createUnsavedSnapshot } from "@/lib/unsavedSnapshot";
import { getProductEstimatorState } from "@/components/ProductPriceEstimator";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import { hasStaffModulePermission } from "../../../shared/staffPermissions.js";

const PRODUCT_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400' viewBox='0 0 600 400'%3E%3Crect width='600' height='400' fill='%23e2e8f0'/%3E%3Cpath d='M248 148h104a28 28 0 0 1 28 28v48a28 28 0 0 1-28 28H248a28 28 0 0 1-28-28v-48a28 28 0 0 1 28-28Zm0 20a8 8 0 0 0-8 8v48a8 8 0 0 0 8 8h104a8 8 0 0 0 8-8v-48a8 8 0 0 0-8-8H248Zm18 22a16 16 0 1 1 0 32 16 16 0 0 1 0-32Zm50 35 17-21 31 40H244l34-42 25 30 13-7Z' fill='%2394a3b8'/%3E%3Ctext x='300' y='292' text-anchor='middle' font-family='Arial, sans-serif' font-size='24' font-weight='700' fill='%23475569'%3EProduct image%3C/text%3E%3C/svg%3E";

const getProductFormSnapshot = (product = {}) => {
  // These values are recalculated by the estimator effect, so they should not
  // make an untouched product form appear dirty.
  const editableFields = Object.fromEntries(
    Object.entries(product).filter(([field]) => field !== "estimated_area" && field !== "estimated_price"),
  );
  return createUnsavedSnapshot({
    ...editableFields,
    imageFiles: Object.keys(editableFields.imageFiles || {}),
  });
};

const MEASUREMENT_UNITS = [
  ["in", "Inches (in)"],
  ["ft", "Feet (ft)"],
  ["cm", "Centimeters (cm)"],
  ["m", "Meters (m)"],
];

const capitalizeFirstLetter = (value) => {
  const text = String(value ?? "");
  return text ? `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}` : text;
};

function CatalogPicker({ label, value, options, catalogItems = [], onChange, onAdd, onEdit, onDelete, placeholder, addLabel, disabled = false }) {
  const { darkMode } = useAdminTheme();
  const actionLabel = label.replace(/\s*\*+\s*$/, "");
  const formatOptionLabel = actionLabel.toLowerCase() === "category" ? capitalizeFirstLetter : (option) => option;
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [savingOption, setSavingOption] = useState(false);
  const [editingOption, setEditingOption] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [error, setError] = useState("");
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setIsOpen(false);
      setIsAdding(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      setIsAdding(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, isAdding, options.length, editingOption, confirmingDelete, error]);

  const saveOption = async (event) => {
    event.preventDefault();
    const trimmedOption = newOption.trim();
    if (!trimmedOption) return;

    setSavingOption(true);
    setError("");
    try {
      const savedOption = await onAdd(trimmedOption);
      onChange(savedOption || trimmedOption);
      setNewOption("");
      setIsAdding(false);
      setIsOpen(false);
    } catch (saveError) {
      setError(saveError?.data?.message || saveError?.message || `Unable to add ${actionLabel.toLowerCase()}.`);
    } finally {
      setSavingOption(false);
    }
  };

  const saveEditedOption = async (event, option) => {
    event.preventDefault();
    const trimmedValue = editingValue.trim();
    if (!trimmedValue || !onEdit) return;
    setSavingOption(true);
    setError("");
    try {
      const updatedName = await onEdit(option, trimmedValue);
      setEditingOption(null);
      setEditingValue("");
    } catch (editError) {
      setError(editError?.data?.message || editError?.message || `Unable to edit ${actionLabel.toLowerCase()}.`);
    } finally {
      setSavingOption(false);
    }
  };

  const deleteOption = async (option) => {
    if (!onDelete) return;
    setSavingOption(true);
    setError("");
    try {
      await onDelete(option);
      if (value === option.name) onChange("");
      setConfirmingDelete(null);
    } catch (deleteError) {
      setError(deleteError?.data?.message || deleteError?.message || `Unable to delete ${actionLabel.toLowerCase()}.`);
    } finally {
      setSavingOption(false);
    }
  };

  return (
    <div className="relative">
      <label className="mb-2 block text-sm font-semibold text-slate-700">{label}</label>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100 hover:border-slate-500 focus:border-red-400 focus:ring-red-400/20" : "border-rose-200 bg-[#fffafa] text-slate-900 hover:border-rose-300 focus:border-red-700 focus:ring-red-100"}`}
      >
        <span className={value ? "truncate" : "truncate text-slate-400"}>{value ? formatOptionLabel(value) : placeholder}</span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && !disabled && (
        <div ref={menuRef} className={`mt-2 flex max-h-80 w-full flex-col overflow-hidden rounded-xl border shadow-xl ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-red-700 bg-white text-slate-900"}`}>
          <div className="min-h-0 max-h-56 flex-1 overflow-y-auto py-1" role="listbox" aria-label={label}>
            {options.map((option) => {
              const entry = catalogItems.find((item) => item.name === option);
              const isEditing = entry && editingOption === entry.id;
              const isConfirmingDelete = entry && confirmingDelete === entry.id;

              return (
                <div key={entry?.id || option} className={`border-b last:border-b-0 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                  {isEditing ? (
                    <form onSubmit={(event) => saveEditedOption(event, entry)} className="flex items-center gap-2 p-2">
                      <input autoFocus value={editingValue} onChange={(event) => setEditingValue(event.target.value)} aria-label={`Edit ${actionLabel}`} className={`min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`} />
                      <button type="submit" disabled={savingOption || !editingValue.trim()} aria-label={`Save ${actionLabel}`} title="Save" className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${darkMode ? "text-emerald-300 hover:bg-slate-800" : "text-emerald-700 hover:bg-emerald-50"}`}><Check size={16} /></button>
                      <button type="button" onClick={() => { setEditingOption(null); setEditingValue(""); setError(""); }} aria-label="Cancel edit" title="Cancel" className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}><X size={16} /></button>
                    </form>
                  ) : isConfirmingDelete ? (
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className={`min-w-0 truncate text-xs ${darkMode ? "text-red-300" : "text-red-800"}`}>Delete “{option}”?</span>
                      <div className="flex shrink-0 gap-1">
                        <button type="button" disabled={savingOption} onClick={() => deleteOption(entry)} className="rounded-md bg-red-700 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Delete</button>
                        <button type="button" onClick={() => setConfirmingDelete(null)} className={`rounded-md px-2 py-1.5 text-xs font-semibold ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 pr-1">
                      <button
                        type="button"
                        role="option"
                        aria-selected={value === option}
                        onClick={() => {
                          onChange(option);
                          setIsOpen(false);
                          setIsAdding(false);
                        }}
                        className={`min-w-0 flex-1 px-4 py-3 text-left text-sm transition ${darkMode ? "hover:bg-slate-800" : "hover:bg-rose-50"} ${value === option ? darkMode ? "bg-red-950/50 font-semibold text-red-200" : "bg-rose-100 font-semibold text-red-900" : darkMode ? "text-slate-200" : "text-slate-800"}`}
                      >
                        {value === option && <span className={`mr-2 ${darkMode ? "text-red-300" : "text-red-800"}`} aria-hidden="true">✓</span>}
                        <span className="truncate">{formatOptionLabel(option)}</span>
                      </button>
                      {entry && onEdit && <button type="button" onClick={() => { setEditingOption(entry.id); setEditingValue(option); setError(""); }} aria-label={`Edit ${actionLabel}: ${option}`} title={`Edit ${option}`} className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${darkMode ? "text-slate-400 hover:bg-slate-800 hover:text-red-300" : "text-slate-500 hover:bg-rose-50 hover:text-red-800"}`}><Pencil size={15} /></button>}
                      {entry && onDelete && <button type="button" onClick={() => { setConfirmingDelete(entry.id); setError(""); }} aria-label={`Delete ${actionLabel}: ${option}`} title={`Delete ${option}`} className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${darkMode ? "text-slate-400 hover:bg-slate-800 hover:text-red-300" : "text-slate-500 hover:bg-rose-50 hover:text-red-800"}`}><Trash2 size={15} /></button>}
                    </div>
                  )}
                </div>
              );
            })}
            {options.length === 0 && <p className={`px-4 py-3 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>No options yet.</p>}
          </div>

          <div className={`shrink-0 border-t p-2 ${darkMode ? "border-slate-700" : "border-rose-100"}`}>
            {error && <p role="alert" className={`mb-2 px-2 text-xs ${darkMode ? "text-red-300" : "text-red-700"}`}>{error}</p>}
            {isAdding ? (
              <form onSubmit={saveOption} className="space-y-2">
                <input
                  autoFocus
                  value={newOption}
                  onChange={(event) => setNewOption(event.target.value)}
                  placeholder={`New ${actionLabel.toLowerCase()}`}
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-red-500 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-400" : "border-rose-200 bg-white text-slate-900"}`}
                />
                {error && <p className={`text-xs ${darkMode ? "text-red-300" : "text-red-600"}`}>{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setIsAdding(false)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}>Cancel</button>
                  <button type="submit" disabled={savingOption || !newOption.trim()} className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${darkMode ? "bg-red-700 hover:bg-red-600" : "bg-red-800"}`}>
                    {savingOption ? "Adding..." : "Add"}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setIsAdding(true)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold ${darkMode ? "text-red-300 hover:bg-slate-800" : "text-red-900 hover:bg-rose-50"}`}
              >
                <Plus size={16} aria-hidden="true" />
                {addLabel || `Add new ${actionLabel.toLowerCase()}...`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductFormModal({
  editingProduct,
  newProduct,
  setNewProduct,
  productTypeOptions,
  categoryOptions,
  variantOptions,
  productTypeCatalogItems,
  categoryCatalogItems,
  variantCatalogItems,
  pricingMethodByName,
  uploaderSections,
  uploadProgress,
  uploading,
  saving,
  modalError,
  saveProduct,
  closeModal,
  cancelUpload,
  saveCatalogOption,
  editCatalogOption,
  deleteCatalogOption,
  canAddProducts,
  canEditProducts,
  canDeleteProducts,
}) {
  const { darkMode } = useAdminTheme();
  const initialProductSnapshot = useRef(getProductFormSnapshot(newProduct));
  const [confirmExit, setConfirmExit] = useState(false);
  const productSnapshot = getProductFormSnapshot(newProduct);
  const hasUnsavedChanges = productSnapshot !== initialProductSnapshot.current;
  const requestClose = () => {
    if (saving || uploading) return;
    if (hasUnsavedChanges) setConfirmExit(true);
    else closeModal();
  };
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || confirmExit) return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmExit, hasUnsavedChanges, saving, uploading]);
  const updateField = (field, value) => setNewProduct((product) => ({ ...product, [field]: value }));
  const [extraChargesOpen, setExtraChargesOpen] = useState(() => Boolean(newProduct.extra_charges?.length));
  const [sizeLimitsOpen, setSizeLimitsOpen] = useState(() => Object.values(newProduct.size_limits || {}).some((value) => Number(value) > 0));
  const mainImage = uploaderSections.find(([key]) => key === "main");
  const angleImages = uploaderSections.filter(([key]) => key !== "main");
  const imageName = (key) => newProduct.imageFiles?.[key]?.name || newProduct.images?.[key]?.split("/").pop() || "";
  const pricingMethodValue = newProduct.pricing_method || "";
  const isFinishedDoorProduct = /finished\s*door/i.test(`${newProduct.product_type || ""} ${newProduct.product_name || ""}`);
  const isJalousiePerBladeProduct = pricingMethodValue === "blade"
    && /jalousie/i.test(newProduct.product_name || newProduct.name || "");
  const extraCharges = Array.isArray(newProduct.extra_charges) ? newProduct.extra_charges : [];
  const areaOptions = Array.isArray(newProduct.area_options) ? newProduct.area_options : [];
  const sizeLimits = newProduct.size_limits || {};

  const updateBladeSellingOption = (field, enabled) => setNewProduct((product) => {
    const updated = { ...product, [field]: enabled };
    const frameTypes = Array.isArray(product.blade_frame_types) ? product.blade_frame_types : [];
    const firstFrameName = frameTypes.find((frame) => String(frame.name || "").trim())?.name || "";

    if (field === "sell_blades_only" && !enabled && product.default_sale_mode === "blades_only") {
      updated.default_sale_mode = "frame";
      updated.default_frame_type = firstFrameName;
    }
    if (field === "sell_with_frame" && enabled && product.default_sale_mode === "frame" && !product.default_frame_type) {
      updated.default_frame_type = firstFrameName;
    }
    if (field === "sell_with_frame" && !enabled) {
      updated.allow_custom_frame_size = false;
      updated.default_frame_type = "";
      if (product.default_sale_mode === "frame") updated.default_sale_mode = product.sell_blades_only ? "blades_only" : "";
    }
    if (!updated.sell_blades_only && !updated.sell_with_frame) {
      updated.default_sale_mode = "";
      updated.default_frame_type = "";
    }
    return updated;
  });

  const updateBladeFrameTypes = (updater) => setNewProduct((product) => {
    const blade_frame_types = updater(Array.isArray(product.blade_frame_types) ? product.blade_frame_types : []);
    const defaultFrameExists = blade_frame_types.some((frame) => frame.name === product.default_frame_type);
    return {
      ...product,
      blade_frame_types,
      default_frame_type: defaultFrameExists ? product.default_frame_type : blade_frame_types[0]?.name || "",
      default_sale_mode: product.default_sale_mode === "frame" && !blade_frame_types.length && !product.allow_custom_frame_size && product.sell_blades_only
        ? "blades_only"
        : product.default_sale_mode,
    };
  });

  const updatePricingMethod = (method) => setNewProduct((product) => {
    const isFinishedDoor = /finished\s*door/i.test(`${product.product_type || ""} ${product.product_name || product.name || ""}`);
    const finishedDoorPricing = {
      ...(product.finished_door_pricing || {}),
      enabled: isFinishedDoor && method === "per_piece",
      measurement_dimension: product.finished_door_pricing?.measurement_dimension || "height",
      standard_size_cm: product.finished_door_pricing?.standard_size_cm || 190,
      standard_price_per_piece: product.finished_door_pricing?.standard_price_per_piece ?? product.base_price ?? "",
      additional_price_per_cm: product.finished_door_pricing?.additional_price_per_cm ?? "",
    };
    if (method !== "blade") return { ...product, pricing_method: method, finished_door_pricing: finishedDoorPricing };

    const bladeGlassTypes = Array.isArray(product.blade_glass_types) && product.blade_glass_types.length
      ? product.blade_glass_types
      : [{ name: "Standard", price_per_blade: product.price_per_blade || "" }];
    const defaultGlass = product.default_blade_glass_type || bladeGlassTypes.find((glass) => String(glass.name || "").trim())?.name || "";
    const sellBladesOnly = product.sell_blades_only !== false;
    const sellWithFrame = Boolean(product.sell_with_frame);
    const defaultSaleMode = product.default_sale_mode || (sellBladesOnly ? "blades_only" : sellWithFrame ? "frame" : "blades_only");

    return {
      ...product,
      pricing_method: method,
      finished_door_pricing: finishedDoorPricing,
      blade_glass_types: bladeGlassTypes,
      sell_blades_only: sellBladesOnly,
      default_blade_glass_type: defaultGlass,
      default_sale_mode: defaultSaleMode,
      minimum_blades: Math.max(1, Number(product.minimum_blades) || 1),
      show_price_per_blade: product.show_price_per_blade !== false,
    };
  });

  const setImageFile = (key, file) => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setNewProduct((product) => ({
      ...product,
      images: { ...product.images, [key]: previewUrl },
      imageFiles: { ...product.imageFiles, [key]: file },
    }));
  };

  const removeImage = (key) => setNewProduct((product) => {
    const images = { ...(product.images || {}) };
    const imageFiles = { ...(product.imageFiles || {}) };
    if (typeof images[key] === "string" && images[key].startsWith("blob:")) {
      URL.revokeObjectURL(images[key]);
    }
    delete images[key];
    delete imageFiles[key];
    return { ...product, images, imageFiles };
  });

  const renderImageDropzone = ([key, label], isMain = false) => (
    <div key={key}>
      <p className="mb-2 text-sm font-semibold text-slate-700">{label}</p>
      <label
        className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed text-center transition ${darkMode ? "border-slate-700 bg-slate-800 hover:border-red-400 hover:bg-slate-700" : "border-rose-200 bg-[#fffafa] hover:border-red-500 hover:bg-rose-50"} ${isMain ? "min-h-36 px-5 py-6" : "aspect-square min-h-24 px-2 py-3"}`}
        onDrop={(event) => {
          event.preventDefault();
          setImageFile(key, event.dataTransfer.files?.[0]);
        }}
        onDragOver={(event) => event.preventDefault()}
      >
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            setImageFile(key, event.target.files?.[0]);
            event.target.value = "";
          }}
          className="sr-only"
        />
        {newProduct.images?.[key] ? (
          <img src={newProduct.images[key]} alt={`${label} preview`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <span className={`mb-2 flex h-9 w-9 items-center justify-center rounded-full ${darkMode ? "bg-slate-700 text-red-300" : "bg-rose-100 text-red-900"}`} aria-hidden="true">
              <Plus size={18} />
            </span>
            <span className={`text-xs font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{label}</span>
            {isMain && <span className="mt-1 text-xs text-slate-400">Drag and drop or browse</span>}
          </>
        )}
        {uploading && uploadProgress[key] !== undefined && (
          <span className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-sm font-semibold text-white">
            Uploading {uploadProgress[key]}%
          </span>
        )}
      </label>
      <div className="mt-1 flex min-h-5 items-center justify-between gap-2">
        <span className={`min-w-0 truncate text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`} title={imageName(key)}>{imageName(key) || ""}</span>
        {newProduct.images?.[key] && (
          <button type="button" onClick={() => removeImage(key)} className={`shrink-0 text-xs font-semibold ${darkMode ? "text-red-300 hover:text-red-200" : "text-red-700 hover:text-red-900"}`}>
            Remove
          </button>
        )}
      </div>
    </div>
  );

  const sectionHeading = (title) => (
    <div className="mb-5 flex items-center gap-3">
      <h3 className={`shrink-0 text-xs font-bold uppercase tracking-[0.14em] ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{title}</h3>
      <div className={`h-px flex-1 ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
    </div>
  );

  const fieldClass = `min-h-12 w-full rounded-xl border px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:ring-2 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100 focus:border-red-400 focus:ring-red-400/20" : "border-rose-200 bg-[#fffafa] text-slate-900 focus:border-red-700 focus:ring-red-100"}`;
  const labelClass = `mb-2 block text-sm font-semibold ${darkMode ? "text-slate-300" : "text-slate-700"}`;
  const estimateProduct = {
    pricing_method: pricingMethodValue,
    base_price: Number(newProduct.base_price) || 0,
    unit_price: Number(newProduct.unit_price) || 0,
    price_per_sqft: Number(newProduct.price_per_sqft) || 0,
    price_per_blade: Number(newProduct.price_per_blade) || 0,
    blade_count: Number(newProduct.blade_count) || 0,
    blade_glass_types: newProduct.blade_glass_types || [],
    piece_options: newProduct.piece_options || [],
    area_options: areaOptions,
    sell_blades_only: newProduct.sell_blades_only !== false,
    sell_with_frame: Boolean(newProduct.sell_with_frame),
    blade_frame_types: newProduct.blade_frame_types || [],
    allow_custom_frame_size: !isJalousiePerBladeProduct && Boolean(newProduct.allow_custom_frame_size),
    custom_frame_price: Number(newProduct.custom_frame_price) || 0,
    minimum_blades: Number(newProduct.minimum_blades) || 1,
    maximum_blades: Number(newProduct.maximum_blades) || 0,
    customer_can_choose_blade_count: Boolean(newProduct.customer_can_choose_blade_count),
    default_blade_glass_type: newProduct.default_blade_glass_type || "",
    default_sale_mode: isJalousiePerBladeProduct
      && newProduct.default_sale_mode === "frame"
      && !(newProduct.blade_frame_types || []).some((frame) => frame.name === newProduct.default_frame_type)
      && newProduct.sell_blades_only
      ? "blades_only"
      : newProduct.default_sale_mode || "blades_only",
    default_frame_type: newProduct.default_frame_type || "",
    show_price_per_blade: newProduct.show_price_per_blade !== false,
    estimated_price_override: Number(newProduct.estimated_price_override) || 0,
    customization: Boolean(newProduct.customization),
    customization_fee: Number(newProduct.customization_fee) || 0,
    extra_charges: newProduct.extra_charges || [],
    measurement_unit: newProduct.unit || "in",
  };
  const defaultGlassTypes = (newProduct.blade_glass_types || []).filter((glass) => String(glass.name || "").trim());
  const defaultFrameTypes = (newProduct.blade_frame_types || []).filter((frame) => String(frame.name || "").trim());
  const defaultExtraCharges = getDefaultExtraChargeSelections({ extra_charges: extraCharges });
  const defaultGlassType = newProduct.default_blade_glass_type || defaultGlassTypes[0]?.name || "";
  const defaultFrameType = defaultFrameTypes.find((frame) => frame.name === newProduct.default_frame_type) || defaultFrameTypes[0];
  const defaultSoldAs = newProduct.default_sale_mode === "frame"
    ? defaultFrameType
      ? `frame:${defaultFrameType.name}`
      : newProduct.allow_custom_frame_size && !isJalousiePerBladeProduct
        ? "custom_frame"
        : "blades_only"
    : "blades_only";
  const estimateItem = {
    width: Number(newProduct.width) || 0,
    height: Number(newProduct.height) || 0,
    measurement_unit: newProduct.unit || "in",
    quantity: 1,
    customized: true,
    blade_glass_type: defaultGlassType,
    piece_option: "",
    piece_options: newProduct.piece_options || [],
    area_option: areaOptions[0]?.name || "",
    area_options: areaOptions,
    sale_mode: isJalousiePerBladeProduct
      && newProduct.default_sale_mode === "frame"
      && !defaultFrameType
      && newProduct.sell_blades_only
      ? "blades_only"
      : newProduct.default_sale_mode || "blades_only",
    frame_type: defaultFrameType?.name || "",
    custom_frame_size: !isJalousiePerBladeProduct && newProduct.default_sale_mode === "frame" && !defaultFrameType && Boolean(newProduct.allow_custom_frame_size),
    extra_charges: defaultExtraCharges,
    blade_count: newProduct.default_sale_mode === "frame" && !isJalousiePerBladeProduct
      ? Number(newProduct.blade_frame_types?.find((frame) => frame.name === (newProduct.default_frame_type || newProduct.blade_frame_types?.[0]?.name))?.blade_count) || Number(newProduct.minimum_blades) || 1
      : Number(newProduct.minimum_blades) || 1,
  };
  const adminEstimatorState = getProductEstimatorState(estimateProduct, {
    unit: estimateItem.measurement_unit,
    width: String(estimateItem.width || 0),
    height: String(estimateItem.height || 0),
    blade_glass_type: estimateItem.blade_glass_type,
    piece_option: estimateItem.piece_option,
    area_option: estimateItem.area_option,
    sale_mode: estimateItem.sale_mode,
    frame_type: estimateItem.frame_type,
    custom_frame_size: estimateItem.custom_frame_size,
    blade_count: estimateItem.blade_count,
    extra_charges: defaultExtraCharges,
  });
  const defaultBladeTotal = pricingMethodValue === "blade"
    ? Number(adminEstimatorState.result?.estimated_price) || 0
    : 0;
  const displayedEstimatedPrice = pricingMethodValue === "blade"
    ? defaultBladeTotal
    : Number(newProduct.estimated_price_override) > 0
      ? getProductLineTotal(estimateProduct, estimateItem)
      : Number(newProduct.estimated_price || 0);
  const baseEstimate = getProductLineTotal(
    { ...estimateProduct, estimated_price_override: 0, extra_charges: [] },
    { ...estimateItem, estimated_price_override: 0 },
  );
  const defaultTotalWithCharges = getProductLineTotal(
    { ...estimateProduct, estimated_price_override: 0 },
    { ...estimateItem, estimated_price_override: 0 },
  );
  const configuredChargeTotal = defaultTotalWithCharges - baseEstimate;
  const overrideAdjustment = displayedEstimatedPrice - defaultTotalWithCharges;
  const estimatedMeasureLabel = pricingMethodValue === "blade"
    ? "Default blade count"
    : pricingMethodValue === "per_meter" ? "Length" : pricingMethodValue === "per_piece" ? "Quantity" : "Estimated area";
  const estimatedMeasureValue = pricingMethodValue === "blade"
    ? adminEstimatorState.result?.areaDisplay || `${Number(estimateItem.blade_count) || 0} blade${Number(estimateItem.blade_count) === 1 ? "" : "s"}`
    : pricingMethodValue === "per_meter"
      ? `${Number(newProduct.width || 0).toLocaleString()} ${newProduct.unit || "m"}`
      : pricingMethodValue === "per_piece" ? "1 piece"
      : `${Number(newProduct.estimated_area || 0).toFixed(2)} sq ft`;
  const pricingMethodCards = [
    { key: "per_piece", title: "Per Piece", badge: "Piece", description: "One set price for each product piece" },
    { key: "sqft", title: "Per Area", badge: "Sq Ft", description: "Width × Height, charged by area" },
    { key: "blade", title: "Per Blade", badge: "Blade", description: "Glass rate, with optional frame" },
  ];
  const currency = (value) => `PHP ${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const configuredGlassTypes = newProduct.blade_glass_types || [];
  const configuredFrameTypes = newProduct.blade_frame_types || [];
  const minimumBlades = Math.max(1, Number(newProduct.minimum_blades) || 1);
  const maximumBlades = Number(newProduct.maximum_blades) || 0;
  const defaultSaleMode = isJalousiePerBladeProduct
    && newProduct.default_sale_mode === "frame"
    && !(newProduct.blade_frame_types || []).some((frame) => frame.name === newProduct.default_frame_type)
    && newProduct.sell_blades_only
    ? "blades_only"
    : newProduct.default_sale_mode || (newProduct.sell_blades_only ? "blades_only" : "frame");
  const defaultGlassIsValid = configuredGlassTypes.some((glass) => glass.name === (newProduct.default_blade_glass_type || configuredGlassTypes[0]?.name));
  const bladeConfigurationIsValid = configuredGlassTypes.length > 0
    && configuredGlassTypes.every((glass) => String(glass.name || "").trim() && Number(glass.price_per_blade) > 0)
    && (newProduct.sell_blades_only || newProduct.sell_with_frame)
    && (!newProduct.sell_with_frame || configuredFrameTypes.length > 0 || (!isJalousiePerBladeProduct && newProduct.allow_custom_frame_size))
    && configuredFrameTypes.every((frame) => String(frame.name || "").trim() && Number(frame.blade_count) >= 1 && Number.isFinite(Number(frame.price)) && Number(frame.price) >= 0)
    && (isJalousiePerBladeProduct || !newProduct.allow_custom_frame_size || Number(newProduct.custom_frame_price) > 0)
    && (!maximumBlades || maximumBlades >= minimumBlades)
    && (!maximumBlades || Math.max(0, ...configuredFrameTypes.map((frame) => Number(frame.blade_count) || 0)) <= maximumBlades)
    && defaultGlassIsValid
    && (defaultSaleMode !== "blades_only" || newProduct.sell_blades_only)
    && (defaultSaleMode !== "frame" || newProduct.sell_with_frame)
    && (defaultSaleMode !== "frame" || !configuredFrameTypes.length || configuredFrameTypes.some((frame) => frame.name === newProduct.default_frame_type))
    && (defaultSaleMode !== "frame" || configuredFrameTypes.length > 0 || newProduct.allow_custom_frame_size);
  const extraChargesAreValid = (newProduct.extra_charges || []).every((charge) => (
    String(charge.name || "").trim()
    && String(charge.amount ?? "").trim() !== ""
    && Number.isFinite(Number(charge.amount))
    && Number(charge.amount) >= 0
  ));
  const areaOptionsAreValid = areaOptions.every((option) => (
    String(option.name || "").trim()
    && (!String(option.price_per_sqft ?? "").trim()
      || (Number.isFinite(Number(option.price_per_sqft)) && Number(option.price_per_sqft) > 0))
  )) && new Set(areaOptions.map((option) => String(option.name || "").trim().toLowerCase())).size === areaOptions.length;
  const areaOptionValidationMessage = "Each variant needs a name, and any entered price must be greater than zero.";
  const hasAreaOptionFieldError = modalError === areaOptionValidationMessage
    || modalError === "Area option names must be unique.";
  const getAreaOptionNameError = (index) => {
    const name = String(areaOptions[index]?.name || "").trim();
    if (modalError === areaOptionValidationMessage && !name) {
      return "Enter an option name.";
    }
    if (modalError === "Area option names must be unique." && name) {
      const firstMatchingIndex = areaOptions.findIndex((option) => String(option.name || "").trim().toLowerCase() === name.toLowerCase());
      if (firstMatchingIndex !== index) return "This option name is already used.";
    }
    return "";
  };
  const getAreaOptionPriceError = (index) => {
    const price = areaOptions[index]?.price_per_sqft;
    const enteredPrice = String(price ?? "").trim();
    return modalError === areaOptionValidationMessage && enteredPrice
      && (!Number.isFinite(Number(price)) || Number(price) <= 0)
      ? "If entered, the price must be greater than zero."
      : "";
  };
  const pricingConfigurationIsValid = pricingMethodValue === "blade"
    ? bladeConfigurationIsValid
    : pricingMethodValue === "sqft"
      ? Number(newProduct.width) > 0 && Number(newProduct.height) > 0 && areaOptionsAreValid
        && (Number(newProduct.price_per_sqft) > 0 || areaOptions.some((option) => Number(option.price_per_sqft) > 0))
      : pricingMethodValue === "per_meter"
        ? Number(newProduct.width) > 0 && Number(newProduct.unit_price) > 0
        : pricingMethodValue === "per_piece"
          ? isFinishedDoorProduct && newProduct.finished_door_pricing?.enabled
            ? String(newProduct.finished_door_pricing?.standard_price_per_piece ?? "").trim() !== "" && Number(newProduct.finished_door_pricing?.standard_price_per_piece) >= 0
            : Number(newProduct.base_price) > 0
      : pricingMethodValue === "fixed"
        ? Boolean(editingProduct || Number(newProduct.base_price) > 0)
        : false;
  const isEstimateReady = pricingMethodValue === "blade"
    ? bladeConfigurationIsValid && adminEstimatorState.hasEstimate
    : pricingConfigurationIsValid && extraChargesAreValid;
  const bladeEstimateIssues = [];
  if (pricingMethodValue === "blade") {
    if (!configuredGlassTypes.length) {
      bladeEstimateIssues.push("Add at least one glass type.");
    } else if (configuredGlassTypes.some((glass) => !String(glass.name || "").trim() || !(Number(glass.price_per_blade) > 0))) {
      bladeEstimateIssues.push("Enter a name and price greater than zero for every glass type.");
    }
    if (!newProduct.sell_blades_only && !newProduct.sell_with_frame) {
      bladeEstimateIssues.push("Choose at least one selling option.");
    }
    if (newProduct.sell_with_frame && !configuredFrameTypes.length && !newProduct.allow_custom_frame_size) {
      bladeEstimateIssues.push("Add a frame type or enable custom frame size.");
    }
    if (configuredFrameTypes.some((frame) => !String(frame.name || "").trim() || !(Number(frame.blade_count) >= 1) || !Number.isFinite(Number(frame.price)) || Number(frame.price) < 0)) {
      bladeEstimateIssues.push("Complete each frame type with a name, blade count, and valid price.");
    }
    if (newProduct.allow_custom_frame_size && !(Number(newProduct.custom_frame_price) > 0)) {
      bladeEstimateIssues.push("Enter a custom frame price greater than zero.");
    }
    if (maximumBlades > 0 && maximumBlades < minimumBlades) {
      bladeEstimateIssues.push("Maximum blades cannot be lower than minimum blades.");
    }
    if (maximumBlades > 0 && Math.max(0, ...configuredFrameTypes.map((frame) => Number(frame.blade_count) || 0)) > maximumBlades) {
      bladeEstimateIssues.push("Maximum blades cannot be lower than a frame type's blade count.");
    }
    if (!defaultGlassIsValid) {
      bladeEstimateIssues.push("Choose a valid default glass type.");
    }
    if ((defaultSaleMode === "blades_only" && !newProduct.sell_blades_only) || (defaultSaleMode === "frame" && !newProduct.sell_with_frame)) {
      bladeEstimateIssues.push("Choose a default selling option that is enabled.");
    }
    if (defaultSaleMode === "frame" && configuredFrameTypes.length && !configuredFrameTypes.some((frame) => frame.name === newProduct.default_frame_type)) {
      bladeEstimateIssues.push("Choose a valid default frame type.");
    }
    if (adminEstimatorState.needsDimensions && (!(estimateItem.width > 0) || !(estimateItem.height > 0))) {
      bladeEstimateIssues.push("Enter width and height for the custom frame estimate.");
    }
    if (!bladeEstimateIssues.length && !adminEstimatorState.hasEstimate) {
      bladeEstimateIssues.push("Check the default glass, sale mode, and blade or frame selection.");
    }
  }

  return (
    <div className="mobile-fullscreen-overlay fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-form-title"
        className={`mobile-fullscreen-dialog flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border shadow-[0_24px_80px_rgba(15,23,42,0.28)] ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-rose-100 bg-white"}`}
      >
        <header className={`flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-7 ${darkMode ? "border-slate-700 bg-slate-800" : "border-rose-100 bg-[#fff8f7]"}`}>
          <div>
            <h2 id="product-form-title" className={`text-xl font-bold ${darkMode ? "text-white" : "text-slate-950"}`}>
              {editingProduct ? "Edit Product" : "Add New Product"}
            </h2>
            <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
              {editingProduct ? "Update the product details and availability." : "Fill in the details to create a new product."}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={saving || uploading}
            aria-label="Close product form"
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-rose-100 bg-white text-slate-500 hover:bg-rose-50 hover:text-slate-900"}`}
          >
            <X size={18} />
          </button>
        </header>

        <div data-catalog-picker-scroll-area className={`min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5 !pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-7 sm:py-6 sm:!pb-6 ${darkMode ? "bg-slate-900" : "bg-white"}`}>
          {modalError && !hasAreaOptionFieldError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {modalError}
            </div>
          )}

          <section>
            {sectionHeading("Product Information")}
            <div className="grid gap-5 md:grid-cols-2">
              <CatalogPicker
                label="Product Type *"
                value={newProduct.product_type}
                options={productTypeOptions}
                catalogItems={productTypeCatalogItems}
                placeholder="Select product type"
                onChange={(value) => setNewProduct((product) => {
                  const isFinishedDoor = /finished\s*door/i.test(value);
                  return {
                    ...product,
                    product_type: value,
                    product_name: "",
                    pricing_method: isFinishedDoor ? "per_piece" : "",
                    variant: "",
                    finished_door_pricing: {
                      ...(product.finished_door_pricing || {}),
                      enabled: isFinishedDoor,
                      measurement_dimension: product.finished_door_pricing?.measurement_dimension || "height",
                      standard_size_cm: product.finished_door_pricing?.standard_size_cm || 190,
                      standard_price_per_piece: product.finished_door_pricing?.standard_price_per_piece ?? product.base_price ?? "",
                      additional_price_per_cm: product.finished_door_pricing?.additional_price_per_cm ?? "",
                    },
                  };
                })}
                onAdd={canAddProducts ? (name) => saveCatalogOption("types", name) : undefined}
                onEdit={canEditProducts ? (item, name) => editCatalogOption("types", item, name) : undefined}
                onDelete={canDeleteProducts ? (item) => deleteCatalogOption("types", item) : undefined}
              />
              <CatalogPicker
                label="Category *"
                value={newProduct.category}
                options={categoryOptions}
                catalogItems={categoryCatalogItems}
                placeholder="Select category"
                onChange={(value) => updateField("category", value)}
                onAdd={canAddProducts ? (name) => saveCatalogOption("categories", name) : undefined}
                onEdit={canEditProducts ? (item, name) => editCatalogOption("categories", item, name) : undefined}
                onDelete={canDeleteProducts ? (item) => deleteCatalogOption("categories", item) : undefined}
              />
              <div className="md:col-span-2">
                <label htmlFor="product-name-input" className={labelClass}>Product Name *</label>
                <input
                  id="product-name-input"
                  type="text"
                  value={newProduct.product_name}
                  disabled={!newProduct.product_type}
                  onChange={(event) => {
                    const value = event.target.value;
                    setNewProduct((product) => {
                      const pricing_method = /finished\s*door/i.test(`${product.product_type || ""} ${value}`) ? "per_piece" : pricingMethodByName[value] || "";
                      const finishedDoor = /finished\s*door/i.test(`${product.product_type || ""} ${value}`);
                      const jalousieBlade = pricing_method === "blade" && /jalousie/i.test(value);
                      const hasConfiguredFrame = (product.blade_frame_types || []).some((frame) => String(frame.name || "").trim());
                      const sellBladesOnly = jalousieBlade && !hasConfiguredFrame ? true : product.sell_blades_only;
                      return {
                        ...product,
                        product_name: value,
                        pricing_method,
                        variant: product.variant || "",
                        finished_door_pricing: finishedDoor ? {
                          enabled: true,
                          measurement_dimension: product.finished_door_pricing?.measurement_dimension || "height",
                          standard_size_cm: product.finished_door_pricing?.standard_size_cm || 190,
                          standard_price_per_piece: product.finished_door_pricing?.standard_price_per_piece ?? product.base_price ?? "",
                          additional_price_per_cm: product.finished_door_pricing?.additional_price_per_cm ?? "",
                        } : { ...(product.finished_door_pricing || {}), enabled: false },
                        ...(jalousieBlade ? {
                          width: "",
                          height: "",
                          standard_size: "",
                          size_limits: { min_width: "", max_width: "", min_height: "", max_height: "", unit: product.unit || "in" },
                          allow_custom_frame_size: false,
                          custom_frame_price: "",
                          sell_blades_only: sellBladesOnly,
                          sell_with_frame: hasConfiguredFrame && product.sell_with_frame,
                          default_sale_mode: sellBladesOnly ? "blades_only" : hasConfiguredFrame ? "frame" : "",
                          default_frame_type: hasConfiguredFrame ? product.default_frame_type || product.blade_frame_types.find((frame) => String(frame.name || "").trim())?.name || "" : "",
                        } : {}),
                      };
                    });
                  }}
                  placeholder="Type product name"
                  className={fieldClass}
                />
              </div>
              {(
                <div className="md:col-span-2">
                  <CatalogPicker
                    label="Variant *"
                    value={newProduct.variant}
                    options={variantOptions}
                    catalogItems={variantCatalogItems[newProduct.product_type] || []}
                    placeholder="Select variant"
                    addLabel={`Add new variant for "${newProduct.product_type}"...`}
                    disabled={!newProduct.product_type}
                    onChange={(value) => updateField("variant", value)}
                    onAdd={canAddProducts ? (name) => saveCatalogOption("variants", name) : undefined}
                    onEdit={canEditProducts ? (item, name) => editCatalogOption("variants", item, name) : undefined}
                    onDelete={canDeleteProducts ? (item) => deleteCatalogOption("variants", item) : undefined}
                  />
                  <p className="mt-2 text-xs text-slate-400">Choose or add a variant for the selected product type.</p>
                </div>
              )}
              <div className="md:col-span-2">
                <label className={labelClass}>Description</label>
                <textarea
                  rows={3}
                  value={newProduct.description}
                  onChange={(event) => updateField("description", event.target.value)}
                  placeholder="Describe the product, materials, use case, and special features..."
                  className={`${fieldClass} resize-y`}
                />
              </div>
            </div>
          </section>

          <section>
            {sectionHeading(pricingMethodValue === "blade" ? "Pricing & Blade Options" : "Price & Size")}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {pricingMethodCards.map((method) => {
                const selected = pricingMethodValue === method.key;
                return (
                  <button
                    key={method.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updatePricingMethod(method.key)}
                    className={`min-w-0 rounded-xl border px-4 py-3.5 text-left transition ${selected ? darkMode ? "border-red-400 bg-red-950/40 ring-1 ring-red-400" : "border-red-800 bg-rose-100 ring-1 ring-red-800" : darkMode ? "border-slate-700 bg-slate-800 hover:border-slate-500" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`text-base font-bold leading-5 ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{method.title}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${darkMode ? selected ? "bg-red-900/70 text-red-100" : "bg-slate-700 text-slate-200" : selected ? "bg-white text-red-900" : "bg-slate-100 text-slate-700"}`}>{method.badge}</span>
                    </span>
                    <span className={`mt-1.5 block text-sm leading-5 ${darkMode ? selected ? "text-red-100" : "text-slate-300" : selected ? "text-red-950" : "text-slate-700"}`}>{method.description}</span>
                  </button>
                );
              })}
            </div>

            <div className={`mt-3 rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-white"}`}>
              {isFinishedDoorProduct && pricingMethodValue === "per_piece" && newProduct.finished_door_pricing?.enabled && (
                <div className={`mb-4 rounded-xl border p-4 ${darkMode ? "border-blue-400/30 bg-blue-400/5" : "border-blue-200 bg-blue-50/60"}`}>
                  <div className="mb-3">
                    <h3 className={`text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Finished Door Standard Size Pricing</h3>
                    <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-600"}`}>Standard size defaults to 190 cm for Finished Door products. Measurements below or exactly at the standard size keep the standard per-piece price; charges apply only to excess size. Custom measurements belong to an individual order or inspection and do not change this product configuration.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>Pricing Type
                      <input readOnly value="Per Piece" className={`${fieldClass} mt-1`} />
                    </label>
                    <label className={labelClass}>Measurement Dimension
                      <CustomerDropdown darkMode value={newProduct.finished_door_pricing?.measurement_dimension || "height"} onChange={(event) => updateField("finished_door_pricing", { ...newProduct.finished_door_pricing, measurement_dimension: event.target.value })} className={`${fieldClass} mt-1`}>
                        <option value="height">Height</option><option value="width">Width</option><option value="length">Length</option>
                      </CustomerDropdown>
                    </label>
                    <label className={labelClass}>Standard Size (cm)
                      <input type="number" min="0.01" step="0.01" value={newProduct.finished_door_pricing?.standard_size_cm ?? 190} onChange={(event) => updateField("finished_door_pricing", { ...newProduct.finished_door_pricing, enabled: true, standard_size_cm: event.target.value })} className={`${fieldClass} mt-1`} />
                    </label>
                    <label className={labelClass}>Standard Price Per Piece (PHP)
                      <input type="number" min="0" step="0.01" value={newProduct.finished_door_pricing?.standard_price_per_piece ?? ""} onChange={(event) => updateField("finished_door_pricing", { ...newProduct.finished_door_pricing, enabled: true, standard_price_per_piece: event.target.value })} className={`${fieldClass} mt-1`} />
                    </label>
                    <label className={labelClass}>Additional Price Per CM (PHP)
                      <input type="number" min="0" step="0.01" value={newProduct.finished_door_pricing?.additional_price_per_cm ?? ""} onChange={(event) => updateField("finished_door_pricing", { ...newProduct.finished_door_pricing, enabled: true, additional_price_per_cm: event.target.value })} className={`${fieldClass} mt-1`} />
                    </label>
                  </div>
                </div>
              )}
              {!pricingMethodValue && (
                <div className={`flex min-h-16 items-center gap-3 rounded-lg border border-dashed px-4 py-3 ${darkMode ? "border-slate-600 bg-slate-900/60 text-slate-300" : "border-slate-300 bg-slate-50 text-slate-600"}`}>
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${darkMode ? "bg-slate-800 text-red-300" : "bg-white text-red-800"}`} aria-hidden="true">1</span>
                  <span className="min-w-0"><span className="block text-sm font-semibold">Choose how this product is priced</span><span className={`mt-0.5 block text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Select Per Piece, Per Area, or Per Blade to configure pricing.</span></span>
                </div>
              )}
              {pricingMethodValue === "per_piece" && !(isFinishedDoorProduct && newProduct.finished_door_pricing?.enabled) && (
                <div className="mb-4">
                  <label className={labelClass}>Price Per Piece  ₱(PHP) *
                    <input type="number" min="0.01" step="0.01" value={newProduct.base_price ?? ""} onChange={(event) => updateField("base_price", event.target.value)} placeholder="0.00" className={`${fieldClass} mt-1`} />
                  </label>
                  <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>This price is charged for each piece. The order total uses the selected quantity.</p>
                </div>
              )}
              {pricingMethodValue === "per_piece" && (
                <div className={`mb-4 border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <div className="mb-3">
                    <h3 className={`text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Product Size (optional specs)</h3>
                    <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>These dimensions are shown to customers and do not change the fixed price per piece.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor="product-piece-measurement-unit" className={labelClass}>Size unit</label>
                      <CustomerDropdown darkMode={darkMode} id="product-piece-measurement-unit" value={newProduct.unit || "in"} onChange={(event) => updateField("unit", event.target.value)} className={fieldClass}>
                        {MEASUREMENT_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </CustomerDropdown>
                    </div>
                    <div>
                      <label htmlFor="product-piece-width" className={labelClass}>Width ({newProduct.unit || "in"})</label>
                      <input id="product-piece-width" type="number" min="0" step="0.01" value={newProduct.width ?? ""} onChange={(event) => updateField("width", event.target.value)} placeholder="Optional" className={fieldClass} />
                    </div>
                    <div>
                      <label htmlFor="product-piece-height" className={labelClass}>Height ({newProduct.unit || "in"})</label>
                      <input id="product-piece-height" type="number" min="0" step="0.01" value={newProduct.height ?? ""} onChange={(event) => updateField("height", event.target.value)} placeholder="Optional" className={fieldClass} />
                    </div>
                  </div>
                </div>
              )}
              {pricingMethodValue === "sqft" && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelClass}>Default price per sq ft (PHP) {areaOptions.length ? "(optional)" : "*"}</label>
                      <input type="number" min="0" step="0.01" value={newProduct.price_per_sqft} onChange={(event) => updateField("price_per_sqft", event.target.value)} placeholder="0.00" className={fieldClass} />
                    </div>
                    <div>
                      <label htmlFor="product-measurement-unit" className={labelClass}>Size unit</label>
                      <CustomerDropdown darkMode={darkMode} id="product-measurement-unit" value={newProduct.unit || "in"} onChange={(event) => updateField("unit", event.target.value)} className={fieldClass}>
                        {MEASUREMENT_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </CustomerDropdown>
                    </div>
                    <div>
                      <label className={labelClass}>Width ({newProduct.unit || "in"}) *</label>
                      <input type="number" min="0" step="0.01" value={newProduct.width} onChange={(event) => updateField("width", event.target.value)} placeholder="0" className={fieldClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Height ({newProduct.unit || "in"}) *</label>
                      <input type="number" min="0" step="0.01" value={newProduct.height} onChange={(event) => updateField("height", event.target.value)} placeholder="0" className={fieldClass} />
                    </div>
                  </div>
                  <p className={`mt-3 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Customers and inspectors can enter a different size for a live estimate.</p>
                  <div className="mt-5">
                    {sectionHeading("Product Attributes and Pricing")}
                    <p className={`-mt-2 mb-3 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Customers and inspectors can choose a variant. If a price is set, that exact amount is added once per item and is not multiplied by the measured area.</p>
                    <div className={`space-y-2 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                      {areaOptions.map((option, index) => (
                        <div key={`area-option-${index}`} className="grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(140px,0.55fr)_auto]">
                          <div className="min-w-0">
                            <input aria-label={`Variant name ${index + 1}`} aria-invalid={Boolean(getAreaOptionNameError(index))} aria-describedby={getAreaOptionNameError(index) ? `area-option-name-error-${index}` : undefined} value={option.name || ""} onChange={(event) => setNewProduct((product) => ({ ...product, area_options: (product.area_options || []).map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} placeholder="Variant name (e.g. Standard, Premium)" className={`${fieldClass} ${getAreaOptionNameError(index) ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" : ""}`} />
                            {getAreaOptionNameError(index) && <p id={`area-option-name-error-${index}`} className="mt-1 text-xs font-medium text-red-600">{getAreaOptionNameError(index)}</p>}
                          </div>
                          <div className="min-w-0">
                            <input aria-label={`Price for variant ${index + 1}`} aria-invalid={Boolean(getAreaOptionPriceError(index))} aria-describedby={getAreaOptionPriceError(index) ? `area-option-price-error-${index}` : undefined} type="number" min="0.01" step="0.01" value={option.price_per_sqft ?? ""} onChange={(event) => setNewProduct((product) => ({ ...product, area_options: (product.area_options || []).map((item, itemIndex) => itemIndex === index ? { ...item, price_per_sqft: event.target.value } : item) }))} placeholder="Fixed PHP amount" className={`${fieldClass} ${getAreaOptionPriceError(index) ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" : ""}`} />
                            {getAreaOptionPriceError(index) && <p id={`area-option-price-error-${index}`} className="mt-1 text-xs font-medium text-red-600">{getAreaOptionPriceError(index)}</p>}
                          </div>
                          <button type="button" aria-label={`Remove variant ${index + 1}`} onClick={() => setNewProduct((product) => ({ ...product, area_options: (product.area_options || []).filter((_, itemIndex) => itemIndex !== index) }))} className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border ${darkMode ? "border-slate-700 text-red-300 hover:bg-slate-800" : "border-slate-200 text-red-700 hover:bg-rose-50"}`}><Trash2 size={16} /></button>
                        </div>
                      ))}
                      <button type="button" onClick={() => updateField("area_options", [...areaOptions, { name: "", price_per_sqft: "" }])} className={`inline-flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm font-semibold ${darkMode ? "border-slate-600 text-red-300 hover:bg-slate-800" : "border-red-300 text-red-800 hover:bg-rose-50"}`}><Plus size={15} />Add option</button>
                    </div>
                  </div>
                </>
              )}

              {pricingMethodValue === "blade" && (
                <div className="space-y-5">
                  <div>
                    {sectionHeading("Glass Types & Price per Blade")}
                    <p className={`-mt-2 mb-3 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Each glass type can have its own price. Customers choose a glass before estimating.</p>
                    <div className={`space-y-2 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                      {(newProduct.blade_glass_types || []).map((glass, index) => (
                        <div key={`glass-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(140px,0.55fr)_auto]">
                          <input aria-label={`Glass type ${index + 1}`} value={glass.name || ""} onChange={(event) => setNewProduct((product) => ({ ...product, blade_glass_types: product.blade_glass_types.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item), default_blade_glass_type: product.default_blade_glass_type === glass.name ? event.target.value : product.default_blade_glass_type || event.target.value }))} placeholder="Glass type (e.g. Clear, Smoke, Reflective)" className={fieldClass} />
                          <input aria-label={`Price per blade for glass type ${index + 1}`} type="number" min="0" step="0.01" value={glass.price_per_blade ?? ""} onChange={(event) => setNewProduct((product) => ({ ...product, blade_glass_types: product.blade_glass_types.map((item, itemIndex) => itemIndex === index ? { ...item, price_per_blade: event.target.value } : item) }))} placeholder="PHP per blade" className={fieldClass} />
                          <button type="button" aria-label={`Remove glass type ${index + 1}`} onClick={() => setNewProduct((product) => {
                            const blade_glass_types = product.blade_glass_types.filter((_, itemIndex) => itemIndex !== index);
                            return { ...product, blade_glass_types, default_blade_glass_type: product.default_blade_glass_type === glass.name ? blade_glass_types[0]?.name || "" : product.default_blade_glass_type };
                          })} className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border ${darkMode ? "border-slate-700 text-red-300 hover:bg-slate-800" : "border-slate-200 text-red-700 hover:bg-rose-50"}`}><Trash2 size={16} /></button>
                        </div>
                      ))}
                      <button type="button" onClick={() => updateField("blade_glass_types", [...(newProduct.blade_glass_types || []), { name: "", price_per_blade: "" }])} className={`inline-flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm font-semibold ${darkMode ? "border-slate-600 text-red-300 hover:bg-slate-800" : "border-red-300 text-red-800 hover:bg-rose-50"}`}><Plus size={15} />Add glass type</button>
                    </div>
                  </div>

                  <div>
                    {sectionHeading("What do you sell?")}
                    <div className="space-y-2">
                      {[["sell_blades_only", "Blades only", "Priced per blade, by glass type."], ["sell_with_frame", "Blades with frame", "Customers can choose a frame and pay its price plus the blades."]].map(([key, title, detail]) => (
                        <label key={key} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                          <input type="checkbox" checked={Boolean(newProduct[key])} onChange={(event) => updateBladeSellingOption(key, event.target.checked)} className="mt-1 accent-red-700" />
                          <span><span className={`block text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{title}</span><span className={`mt-0.5 block text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{detail}</span></span>
                        </label>
                      ))}
                    </div>
                    {!newProduct.sell_blades_only && !newProduct.sell_with_frame && <p className="mt-2 text-xs text-red-600">Enable at least one selling option.</p>}
                  </div>

                  {newProduct.sell_with_frame && (
                    <div>
                      {sectionHeading("Blades with Frame")}
                      <p className={`-mt-2 mb-3 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Set the frame types customers can choose. Each frame includes a blade count and frame price.</p>
                      <div className={`space-y-3 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                        {!isJalousiePerBladeProduct && <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                          <input
                            type="checkbox"
                            checked={Boolean(newProduct.allow_custom_frame_size)}
                            onChange={(event) => {
                              const enabled = event.target.checked;
                              setNewProduct((product) => ({
                                ...product,
                                allow_custom_frame_size: enabled,
                                default_sale_mode: !enabled && product.default_sale_mode === "frame" && !(product.blade_frame_types || []).length && product.sell_blades_only ? "blades_only" : product.default_sale_mode,
                              }));
                            }}
                            className="mt-1 accent-red-700"
                          />
                          <span><span className={`block text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Allow custom frame size</span><span className={`mt-0.5 block text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Customers can enter their own width and height. Use one flat frame price.</span></span>
                        </label>}
                        {newProduct.allow_custom_frame_size && !isJalousiePerBladeProduct && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label htmlFor="custom-frame-unit" className={labelClass}>Frame size unit</label>
                              <CustomerDropdown darkMode={darkMode} id="custom-frame-unit" value={newProduct.custom_frame_size_unit || "in"} onChange={(event) => updateField("custom_frame_size_unit", event.target.value)} className={fieldClass}>
                                {MEASUREMENT_UNITS.map(([unit, label]) => <option key={unit} value={unit}>{label}</option>)}
                              </CustomerDropdown>
                            </div>
                            <div>
                              <label className={labelClass}>Custom frame price (PHP) *</label>
                              <input type="number" min="0" step="0.01" value={newProduct.custom_frame_price} onChange={(event) => updateField("custom_frame_price", event.target.value)} placeholder="0.00" className={fieldClass} />
                            </div>
                          </div>
                        )}
                        {(newProduct.blade_frame_types || []).map((frame, index) => (
                          <div key={`frame-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(90px,0.35fr)_minmax(120px,0.55fr)_auto]">
                            <input aria-label={`Frame type ${index + 1}`} value={frame.name || ""} onChange={(event) => setNewProduct((product) => ({ ...product, blade_frame_types: product.blade_frame_types.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item), default_frame_type: product.default_frame_type === frame.name ? event.target.value : product.default_frame_type || event.target.value }))} placeholder="Frame type (e.g. Small)" className={fieldClass} />
                            <input aria-label={`Blade count for frame type ${index + 1}`} type="number" min="1" step="1" value={frame.blade_count ?? ""} onChange={(event) => updateBladeFrameTypes((frames) => frames.map((item, itemIndex) => itemIndex === index ? { ...item, blade_count: event.target.value } : item))} placeholder="Blades" className={fieldClass} />
                            <input aria-label={`Frame price for frame type ${index + 1}`} type="number" min="0" step="0.01" value={frame.price ?? ""} onChange={(event) => updateBladeFrameTypes((frames) => frames.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item))} placeholder="Frame price (PHP)" className={fieldClass} />
                            <button type="button" aria-label={`Remove frame type ${index + 1}`} onClick={() => setNewProduct((product) => {
                              const blade_frame_types = product.blade_frame_types.filter((_, itemIndex) => itemIndex !== index);
                              return { ...product, blade_frame_types, default_frame_type: product.default_frame_type === frame.name ? blade_frame_types[0]?.name || "" : product.default_frame_type };
                            })} className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border ${darkMode ? "border-slate-700 text-red-300 hover:bg-slate-800" : "border-slate-200 text-red-700 hover:bg-rose-50"}`}><Trash2 size={16} /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => updateBladeFrameTypes((frames) => [...frames, { name: "", blade_count: "", price: "" }])} className={`inline-flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm font-semibold ${darkMode ? "border-slate-600 text-red-300 hover:bg-slate-800" : "border-red-300 text-red-800 hover:bg-rose-50"}`}><Plus size={15} />Add frame type</button>
                      </div>
                    </div>
                  )}

                  <div>
                    {sectionHeading("Blade Limits")}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Minimum blades (blades only)</label>
                        <input type="number" min="1" step="1" value={newProduct.minimum_blades} onChange={(event) => updateField("minimum_blades", event.target.value)} className={fieldClass} />
                      </div>
                      <div>
                        <label className={labelClass}>Maximum blades (optional)</label>
                        <input type="number" min="1" step="1" value={newProduct.maximum_blades} onChange={(event) => updateField("maximum_blades", event.target.value)} placeholder="No maximum" className={fieldClass} />
                      </div>
                    </div>
                    <label className={`mt-3 flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                      <input type="checkbox" checked={Boolean(newProduct.customer_can_choose_blade_count)} onChange={(event) => updateField("customer_can_choose_blade_count", event.target.checked)} className="mt-1 accent-red-700" />
                      <span><span className={`block text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Customer can choose their own number of blades</span><span className={`mt-0.5 block text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Customer selection stays within the minimum and maximum.</span></span>
                    </label>
                    <div className="mt-5">
                      {sectionHeading("Default Product")}
                      <p className={`-mt-2 mb-4 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Choose what customers get when they add this product to their cart. They can still change the glass type and frame before ordering.</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Glass type</label>
                        <CustomerDropdown darkMode={darkMode} value={defaultGlassType} onChange={(event) => updateField("default_blade_glass_type", event.target.value)} className={fieldClass}>
                          <option value="">Select glass type</option>
                          {defaultGlassTypes.map((glass) => <option key={glass.name} value={glass.name}>{glass.name} — {currency(glass.price_per_blade)}/blade</option>)}
                        </CustomerDropdown>
                      </div>
                      <div>
                        <label className={labelClass}>Sold as</label>
                        <CustomerDropdown darkMode={darkMode}
                          value={defaultSoldAs}
                          onChange={(event) => {
                            const selectedValue = event.target.value;
                            const frameName = selectedValue.startsWith("frame:") ? selectedValue.slice("frame:".length) : "";
                            const isCustomFrame = selectedValue === "custom_frame";
                            setNewProduct((product) => ({
                              ...product,
                              default_sale_mode: frameName || isCustomFrame ? "frame" : "blades_only",
                              default_frame_type: frameName,
                            }));
                          }}
                          className={fieldClass}
                        >
                          {newProduct.sell_blades_only && <option value="blades_only">Blades only (no frame)</option>}
                          {newProduct.sell_with_frame && defaultFrameTypes.map((frame) => (
                            <option key={frame.name} value={`frame:${frame.name}`}>
                              {frame.name} frame — {Number(frame.blade_count) || 0} blades · +{currency(frame.price)}
                            </option>
                          ))}
                          {newProduct.sell_with_frame && newProduct.allow_custom_frame_size && defaultFrameTypes.length === 0 && (
                            <option value="custom_frame">Custom frame size — +{currency(newProduct.custom_frame_price)}</option>
                          )}
                        </CustomerDropdown>
                      </div>
                    </div>
                    <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                      <span className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Default total <strong className={darkMode ? "text-white" : "text-slate-900"}>{isEstimateReady ? currency(defaultBladeTotal) : "—"}</strong></span>
                      <button type="button" onClick={() => updateField("estimated_price_override", baseEstimate > 0 ? String(baseEstimate) : "")} disabled={!isEstimateReady || baseEstimate <= 0} className={`rounded-lg border border-dashed px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 text-red-300" : "border-red-300 text-red-800"}`}>Use as Product Price</button>
                    </div>
                  </div>

                  <div className="mt-5">
                    {sectionHeading("Customer Price Display")}
                  </div>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                    <input type="checkbox" checked={newProduct.show_price_per_blade !== false} onChange={(event) => updateField("show_price_per_blade", event.target.checked)} className="mt-1 accent-red-700" />
                    <span><span className={`block text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Show price per blade</span><span className={`mt-0.5 block text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Customers see the price per blade and glass price breakdown.</span></span>
                  </label>
                </div>
              )}

              {pricingMethodValue === "per_piece" && (
                <div>
                  {sectionHeading("Product Attributes and Pricing")}
                  <p className={`-mt-2 mb-3 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Add optional per-piece charges, such as color or finish. The selected option is added to the product's base price.</p>
                  <div className={`space-y-2 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                    {(newProduct.piece_options || []).map((option, index) => (
                      <div key={`piece-option-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(140px,0.55fr)_auto]">
                        <input aria-label={`Per piece option ${index + 1}`} value={option.name || ""} onChange={(event) => setNewProduct((product) => ({ ...product, piece_options: product.piece_options.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} placeholder="Option name (e.g. Standard, Premium)" className={fieldClass} />
                        <input aria-label={`Price per piece for option ${index + 1}`} type="number" min="0" step="0.01" value={option.price_per_piece ?? ""} onChange={(event) => setNewProduct((product) => ({ ...product, piece_options: product.piece_options.map((item, itemIndex) => itemIndex === index ? { ...item, price_per_piece: event.target.value } : item) }))} placeholder="PHP per piece" className={fieldClass} />
                        <button type="button" aria-label={`Remove per piece option ${index + 1}`} onClick={() => setNewProduct((product) => ({ ...product, piece_options: product.piece_options.filter((_, itemIndex) => itemIndex !== index) }))} className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border ${darkMode ? "border-slate-700 text-red-300 hover:bg-slate-800" : "border-slate-200 text-red-700 hover:bg-rose-50"}`}><Trash2 size={16} /></button>
                      </div>
                    ))}
                    <button type="button" onClick={() => updateField("piece_options", [...(newProduct.piece_options || []), { name: "", price_per_piece: "" }])} className={`inline-flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm font-semibold ${darkMode ? "border-slate-600 text-red-300 hover:bg-slate-800" : "border-red-300 text-red-800 hover:bg-rose-50"}`}><Plus size={15} />Add option</button>
                  </div>
                </div>
              )}

              {pricingMethodValue === "fixed" && (
                <p className={`text-sm ${darkMode ? "text-amber-300" : "text-amber-800"}`}>This product uses a legacy fixed price. Choose Per Area or Per Blade to change its pricing method.</p>
              )}
            </div>

            <div className="mt-3">
              <label className={labelClass}>Manual Product Price Override (PHP)</label>
              <input type="number" min="0" step="0.01" value={newProduct.estimated_price_override || ""} onChange={(event) => updateField("estimated_price_override", event.target.value)} placeholder="Enter adjusted product base price" className={fieldClass} />
              <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                {pricingMethodValue === "blade"
                  ? "Sets the base price for the default blade and frame selection. Other blade counts scale from that price. Required charges are added separately; optional charges are added only when selected."
                  : ["sqft", "per_meter"].includes(pricingMethodValue)
                    ? "Sets the base price at the product's listed size. It scales with measured area or length. Required charges are added separately; optional charges are added only when selected."
                    : "Sets the product base price. Required charges are added separately; optional charges are added only when selected."}
              </p>
            </div>

            <div className={`mt-3 overflow-hidden rounded-xl border ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              <button type="button" aria-expanded={extraChargesOpen} onClick={() => setExtraChargesOpen((open) => !open)} className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold ${darkMode ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`}>
                <span>Extra Charges <span className="font-normal text-slate-400">(optional)</span></span>
                <ChevronDown size={16} className={`transition ${extraChargesOpen ? "rotate-180" : ""}`} />
              </button>
              {extraChargesOpen && (
                <div className={`space-y-3 border-t p-4 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Required charges are included. Optional charges stay unchecked until the customer selects them.</p>
                  {extraCharges.map((charge, index) => (
                    <div key={`extra-charge-${index}`} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(160px,0.8fr)_minmax(110px,0.6fr)_minmax(175px,0.8fr)_auto]">
                      <input aria-label={`Extra charge ${index + 1} name`} value={charge.name || ""} onChange={(event) => setNewProduct((product) => ({ ...product, extra_charges: product.extra_charges.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} placeholder="Charge name" className={fieldClass} />
                      <CustomerDropdown darkMode={darkMode} aria-label={`Extra charge ${index + 1} calculation`} value={charge.type || "fixed"} onChange={(event) => setNewProduct((product) => ({ ...product, extra_charges: product.extra_charges.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item) }))} className={fieldClass}>
                        <option value="fixed">Fixed / item</option>
                        <option value="per_sqft">Per sq ft</option>
                        <option value="per_blade">Per blade</option>
                        <option value="percentage">Percent of base</option>
                      </CustomerDropdown>
                      <input aria-label={`Extra charge ${index + 1} amount`} type="number" min="0" step="0.01" value={charge.amount ?? ""} onChange={(event) => setNewProduct((product) => ({ ...product, extra_charges: product.extra_charges.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item) }))} placeholder={charge.type === "percentage" ? "10" : "0.00"} className={fieldClass} />
                      <CustomerDropdown darkMode={darkMode} aria-label={`Extra charge ${index + 1} customer selection`} value={charge.is_optional ? "optional" : "required"} onChange={(event) => setNewProduct((product) => ({ ...product, extra_charges: product.extra_charges.map((item, itemIndex) => itemIndex === index ? { ...item, is_optional: event.target.value === "optional", is_default_selected: false } : item) }))} className={fieldClass}>
                        <option value="required">Required</option>
                        <option value="optional">Optional (customer choice)</option>
                      </CustomerDropdown>
                      <button type="button" aria-label={`Remove extra charge ${index + 1}`} onClick={() => updateField("extra_charges", extraCharges.filter((_, itemIndex) => itemIndex !== index))} className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border ${darkMode ? "border-slate-700 text-red-300 hover:bg-slate-800" : "border-slate-200 text-red-700 hover:bg-rose-50"}`}><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => updateField("extra_charges", [...extraCharges, { name: "", type: "fixed", amount: "", is_active: true, is_optional: true, is_default_selected: false }])} className={`inline-flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm font-semibold ${darkMode ? "border-slate-600 text-red-300 hover:bg-slate-800" : "border-red-300 text-red-800 hover:bg-rose-50"}`}><Plus size={15} />Add charge</button>
                </div>
              )}
            </div>

            {!isJalousiePerBladeProduct && <div className={`mt-3 overflow-hidden rounded-xl border ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              <button type="button" aria-expanded={sizeLimitsOpen} onClick={() => setSizeLimitsOpen((open) => !open)} className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold ${darkMode ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`}>
                <span>Size Limits <span className="font-normal text-slate-400">(optional · warns customers)</span></span>
                <ChevronDown size={16} className={`transition ${sizeLimitsOpen ? "rotate-180" : ""}`} />
              </button>
              {sizeLimitsOpen && (
                <div className={`grid grid-cols-2 gap-3 border-t p-4 lg:grid-cols-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  {[["min_width", "Min width"], ["max_width", "Max width"], ["min_height", "Min height"], ["max_height", "Max height"]].map(([key, label]) => (
                    <div key={key}>
                      <label className={labelClass}>{label}</label>
                      <input type="number" min="0" step="0.01" value={sizeLimits[key] ?? ""} onChange={(event) => updateField("size_limits", { ...sizeLimits, [key]: event.target.value })} className={fieldClass} />
                    </div>
                  ))}
                  <div>
                    <label htmlFor="product-size-limit-unit" className={labelClass}>Unit</label>
                    <CustomerDropdown darkMode={darkMode} id="product-size-limit-unit" value={sizeLimits.unit || newProduct.unit || "in"} onChange={(event) => updateField("size_limits", { ...sizeLimits, unit: event.target.value })} className={fieldClass}>
                      {MEASUREMENT_UNITS.map(([value]) => <option key={value} value={value}>{value}</option>)}
                    </CustomerDropdown>
                  </div>
                </div>
              )}
            </div>}

            <div className={`mt-3 rounded-xl border px-4 py-3 ${darkMode ? "border-red-900 bg-red-950/40" : "border-rose-300 bg-rose-50"}`}>
              <p className={`text-sm font-bold ${darkMode ? "text-red-300" : "text-red-950"}`}>
                {pricingMethodValue === "blade" ? "Estimated cost for the default selection" : pricingMethodValue === "sqft" ? "Estimated cost for the size above" : "Estimated cost"}
              </p>
              {isEstimateReady ? (
                <div className={`mt-3 space-y-2 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  <div className="flex items-center justify-between gap-4">
                    <span>{estimatedMeasureLabel}</span>
                    <span className={`shrink-0 text-right font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{estimatedMeasureValue}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Base price</span>
                    <span className={`shrink-0 text-right font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{currency(baseEstimate)}</span>
                  </div>
                  {configuredChargeTotal > 0 && (
                    <div className="flex items-center justify-between gap-4">
                      <span>Extra charges</span>
                      <span className={`shrink-0 text-right font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{currency(configuredChargeTotal)}</span>
                    </div>
                  )}
                  {Number(newProduct.estimated_price_override) > 0 && Math.abs(overrideAdjustment) > 0.01 && (
                    <div className="flex items-center justify-between gap-4">
                      <span>Override adjustment</span>
                      <span className={`shrink-0 text-right font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{currency(overrideAdjustment)}</span>
                    </div>
                  )}
                  <div className={`flex items-center justify-between gap-4 border-t pt-2 ${darkMode ? "border-red-900 text-red-300" : "border-rose-300 text-red-950"}`}>
                    <span className="font-bold">Estimated total</span>
                    <span className="shrink-0 text-right text-sm font-black">{currency(displayedEstimatedPrice)}</span>
                  </div>
                </div>
              ) : (
                <>
                  <p className={`mt-2 text-sm ${darkMode ? "text-slate-400" : "text-slate-600"}`}>—</p>
                  {pricingMethodValue === "blade" && bladeEstimateIssues.length > 0 && (
                    <div role="status" aria-live="polite" className={`mt-3 rounded-lg border px-3 py-2 ${darkMode ? "border-amber-800 bg-amber-950/40 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                      <p className="text-xs font-semibold">Complete the blade setup to show the estimate:</p>
                      <ul className="mt-1 list-inside list-disc space-y-1 text-xs">
                        {bladeEstimateIssues.map((issue) => <li key={issue}>{issue}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>

          </section>

          <section>
            {sectionHeading("Product Images")}
            {mainImage && renderImageDropzone(mainImage, true)}
            <div className="mt-5">
              <p className="mb-3 text-sm font-semibold text-slate-700">Viewing Angles</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {angleImages.map((section) => renderImageDropzone(section))}
              </div>
            </div>
            {uploading && (
              <div className={`mt-4 flex flex-col gap-3 rounded-xl border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-emerald-800 bg-emerald-950/40 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                <span>Uploading images...</span>
                <button type="button" onClick={cancelUpload} className={`self-start rounded-lg border px-3 py-2 text-xs font-semibold sm:self-auto ${darkMode ? "border-emerald-700 bg-slate-800 text-emerald-300 hover:bg-slate-700" : "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100"}`}>
                  Cancel upload
                </button>
              </div>
            )}
          </section>

          <section>
            {sectionHeading("Status")}
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(newProduct.is_active)}
              onClick={() => updateField("is_active", !newProduct.is_active)}
              className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${darkMode ? "border-slate-700 bg-slate-800 hover:border-slate-600 hover:bg-slate-700 focus-visible:ring-offset-slate-900" : "border-rose-100 bg-[#fffafa] hover:border-rose-200 focus-visible:ring-offset-white"}`}
            >
              <span>
                <span className={`block text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-800"}`}>Active Product</span>
                <span className={`mt-1 block text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{newProduct.is_active ? "This product is live and visible." : "This product is hidden from customers."}</span>
              </span>
              <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${newProduct.is_active ? "bg-emerald-500" : darkMode ? "bg-slate-600" : "bg-slate-300"}`}>
                <span className={`h-5 w-5 rounded-full bg-white shadow transition ${newProduct.is_active ? "translate-x-5" : "translate-x-0.5"}`} />
              </span>
            </button>
          </section>
        </div>

        <footer className={`sticky bottom-0 z-20 flex shrink-0 justify-end gap-3 border-t px-5 py-3 sm:px-7 lg:static lg:z-auto ${darkMode ? "border-slate-700 bg-slate-800" : "border-rose-100 bg-[#fff8f7]"}`}>
          <button type="button" onClick={requestClose} disabled={saving || uploading} className={`rounded-xl border px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-700" : "border-rose-200 bg-white text-slate-700 hover:bg-rose-50"}`}>
            Cancel
          </button>
          <button type="button" onClick={saveProduct} disabled={saving || uploading} className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "bg-red-700 hover:bg-red-600" : "bg-red-900 hover:bg-red-800"}`}>
            <Check size={16} aria-hidden="true" />
            {saving ? "Saving..." : editingProduct ? "Update Product" : "Create Product"}
          </button>
        </footer>
      </section>
      <UnsavedChangesDialog open={confirmExit} darkMode={darkMode} onStay={() => setConfirmExit(false)} onDiscard={closeModal} />
    </div>
  );
}

function Products() {
  const isMobile = useIsMobile();
  const { darkMode } = useAdminTheme();
  const API_HOST = (function getApiHost() {
    try {
      return (API_BASE || "").replace(/\/api$/, "");
    } catch (e) {
      return "";
    }
  })();

  const isLocalBlobOrFile = (url) => typeof url === "string" && (url.startsWith("blob:") || url.startsWith("file:"));
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const normalizeImageMap = (images = {}) => {
    if (!images || typeof images !== "object" || Array.isArray(images)) return {};
    return Object.fromEntries(
      Object.entries(images)
        .filter(([, value]) => typeof value === "string" ? value.trim() : Boolean(value))
    );
  };

  const hasUsableProductImage = (product = {}) => {
    if (product.image_url && !isLocalBlobOrFile(product.image_url)) return true;
    const images = product.images;
    if (typeof images === "string") return Boolean(images.trim()) && !isLocalBlobOrFile(images);
    if (Array.isArray(images)) {
      return images.some((image) => {
        const imageUrl = typeof image === "string" ? image : image?.url;
        return Boolean(imageUrl) && !isLocalBlobOrFile(imageUrl);
      });
    }
    if (images && typeof images === "object") {
      return Object.values(images).some((imageUrl) => (
        typeof imageUrl === "string" && imageUrl.trim() && !isLocalBlobOrFile(imageUrl)
      ));
    }
    return false;
  };

  const isRenderableProduct = (product = {}) => (
    Boolean(product.id || product._id) &&
    Boolean(String(product.product_name || product.name || "").trim()) &&
    Boolean(String(product.product_type || product.type || "").trim()) &&
    Boolean(String(product.category || "").trim()) &&
    hasUsableProductImage(product)
  );

  const ensureAbsoluteUrl = (url) => {
    if (!url) return PRODUCT_IMAGE_PLACEHOLDER;
    if (isLocalBlobOrFile(url)) return PRODUCT_IMAGE_PLACEHOLDER;
    url = resolveBackendImageUrl(url);
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("/")) return API_HOST ? `${API_HOST}${url}` : url;
    if (url.startsWith("uploads/")) return API_HOST ? `${API_HOST}/${url}` : `/${url}`;
    return API_HOST ? `${API_HOST}/${url}` : url;
  };

  const resolveProductImage = (product) => {
    if (!product) return PRODUCT_IMAGE_PLACEHOLDER;
    const hasImageUrlField = hasOwn(product, "image_url");
    if (product.image_url && !isLocalBlobOrFile(product.image_url)) return ensureAbsoluteUrl(product.image_url);
    const imgs = product.images;
    if (imgs && typeof imgs === "object" && !Array.isArray(imgs) && hasOwn(imgs, "main")) {
      return ensureAbsoluteUrl(imgs.main);
    }
    if (hasImageUrlField || (imgs && typeof imgs === "object" && !Array.isArray(imgs))) {
      return PRODUCT_IMAGE_PLACEHOLDER;
    }
    if (typeof imgs === "string") return ensureAbsoluteUrl(imgs);
    if (Array.isArray(imgs) && imgs.length > 0) {
      const first = imgs[0];
      if (typeof first === "string") return ensureAbsoluteUrl(first);
      if (first && typeof first === "object" && first.url) return ensureAbsoluteUrl(first.url);
    }
    if (!hasImageUrlField && !hasOwn(product, "images") && product.image && !isLocalBlobOrFile(product.image)) {
      return ensureAbsoluteUrl(product.image);
    }
    return PRODUCT_IMAGE_PLACEHOLDER;
  };

  const getProductPriceLabel = (product) => {
    const sqftPrice = Number(product.price_per_sqft || 0);
    const bladePrice = Number(product.price_per_blade || 0);
    const unitPrice = Number(product.unit_price || 0);
    const basePrice = Number(product.base_price || 0);
    const pricingMethod = product.pricing_method || PRICING_METHOD[product.product_name] || (
      sqftPrice > 0 || product.unit === "per_sqft"
        ? "sqft"
        : bladePrice > 0
        ? "blade"
        : product.unit === "per_meter"
        ? "per_meter"
        : unitPrice > 0 || basePrice > 0
        ? "fixed"
        : ""
    );
    const override = Number(product.estimated_price_override) || 0;
    if (override > 0) {
      if (pricingMethod === "blade") {
        const overrideRate = getBladePriceOverrideRate(product);
        return `₱${overrideRate.toLocaleString("en-PH", { maximumFractionDigits: 2 })} / blade`;
      }
      if (pricingMethod === "sqft") {
        const standardArea = Number(product.estimated_area) || (Number(product.width) > 0 && Number(product.height) > 0
          ? toSquareFeet(Number(product.width), Number(product.height), product.measurement_unit || "in")
          : 0);
        const overrideRate = standardArea > 0 ? override / standardArea : override;
        return `₱${overrideRate.toLocaleString("en-PH", { maximumFractionDigits: 2 })} / sq ft`;
      }
      if (pricingMethod === "per_meter") {
        const length = Number(product.width ?? product.length) || 0;
        const unit = product.measurement_unit || product.unit || "m";
        const meters = length * ({ in: 0.0254, ft: 0.3048, cm: 0.01, m: 1 }[unit] || 1);
        const overrideRate = meters > 0 ? override / meters : override;
        return `₱${overrideRate.toLocaleString("en-PH", { maximumFractionDigits: 2 })} / meter`;
      }
      if (pricingMethod === "per_piece") {
        return `₱${override.toLocaleString("en-PH", { maximumFractionDigits: 2 })} / piece`;
      }
      return `₱${override.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
    }

    if (pricingMethod === "blade") {
      if (bladePrice > 0) return `₱${bladePrice.toLocaleString()} / blade`;
      if (unitPrice > 0) return `₱${unitPrice.toLocaleString()} / blade`;
      return "Contact us / blade";
    }

    if (pricingMethod === "sqft") {
      if (sqftPrice > 0) return `₱${sqftPrice.toLocaleString()} / sq ft`;
      if (Number(product.area_options?.[0]?.price_per_sqft) > 0) return `Variant from ₱${Number(product.area_options[0].price_per_sqft).toLocaleString()} / item`;
      if (unitPrice > 0) return `₱${unitPrice.toLocaleString()} / sq ft`;
      return "Contact us / sq ft";
    }

    if (pricingMethod === "per_meter") {
      return unitPrice > 0 ? `₱${unitPrice.toLocaleString()} / meter` : "Contact us / meter";
    }

    if (pricingMethod === "per_piece") {
      const piecePrice = basePrice || unitPrice;
      return piecePrice > 0 ? `₱${piecePrice.toLocaleString()} / piece` : "Contact us / piece";
    }

    if (pricingMethod === "fixed") {
      const fixedPrice = unitPrice || basePrice;
      if (fixedPrice > 0) return `₱${fixedPrice.toLocaleString()}`;
      if (bladePrice > 0) return `₱${bladePrice.toLocaleString()} / blade`;
      if (sqftPrice > 0) return `₱${sqftPrice.toLocaleString()} / sq ft`;
      return "Contact us";
    }

    if (unitPrice > 0) {
      return `₱${unitPrice.toLocaleString()}`;
    }

    return "Contact us";
  };

  const getProductEstimatedCost = (product) => {
    if (["per_piece", "piece", "per_set", "set"].includes(String(product.pricing_method || product.unit || "").toLowerCase())) {
      return Number(product.estimated_price_override)
        || Number(product.base_price)
        || Number(product.unit_price)
        || Number(product.estimated_price)
        || 0;
    }

    if (product.pricing_method === "blade" || PRICING_METHOD[product.product_name] === "blade") {
      return getDefaultProductLineTotal(product);
    }

    const override = Number(product.estimated_price_override || 0);
    if (override > 0) {
      return getProductLineTotal(product, {
        width: Number(product.width) || 0,
        height: Number(product.height) || 0,
        measurement_unit: product.measurement_unit || "in",
        blade_count: Number(product.blade_count) || Number(product.minimum_blades) || 1,
        quantity: 1,
      });
    }

    if (product.pricing_method === "fixed") {
      return Number(product.base_price || product.unit_price || product.estimated_price || 0);
    }

    if (product.pricing_method === "per_meter" || product.unit === "per_meter") {
      return getProductLineTotal(product, {
        width: Number(product.width) || 0,
        measurement_unit: product.measurement_unit || "m",
        quantity: 1,
      });
    }

    if (product.pricing_method === "per_piece") {
      return getProductLineTotal(product, { quantity: 1 });
    }

    const savedEstimate = Number(product.estimated_price || 0);
    const configuredEstimate = getProductLineTotal(product, {
      width: Number(product.width) || 0,
      height: Number(product.height) || 0,
      measurement_unit: product.measurement_unit || "in",
      blade_count: Number(product.blade_count) || Number(product.minimum_blades) || 1,
      quantity: 1,
    });
    return configuredEstimate > 0 ? configuredEstimate : savedEstimate;
  };

  const [isSidebarOpen, setIsSidebarOpen] =
    useState(() => {
      if (typeof window === "undefined") return true;
      const stored = localStorage.getItem("sidebarOpen");
      return stored !== null ? JSON.parse(stored) : true;
    });

  const [search, setSearch] = useState("");

  const [categoryFilter, setCategoryFilter] =
    useState("All");
  const [typeFilter, setTypeFilter] =
    useState("All");
  const [statusFilter, setStatusFilter] =
    useState("All");

  const [currentPage, setCurrentPage] =
    useState(1);

  const [showModal, setShowModal] =
    useState(false);

  const [products, setProducts] = useState([]);

  // Legacy pricing-method fallback for older product records.
  const PRICING_METHOD = {
    "Sliding Window": "sqft",
    "Aluminum Window": "sqft",
    "Sink Cabinet": "sqft",
    "Hanging Cabinet": "sqft",
    "Glass Door": "",
    "Aluminum Door": "",
    "Jalousie Window": "blade",
  };

  const getCatalogPayload = (value) => value?.items || value?.data || value || [];

  const getCatalogText = (value, fallback = "") => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (typeof value === "object") {
      return String(
        value.name ||
        value.type ||
        value.variant ||
        value.product_name ||
        value.product_type ||
        value.title ||
        fallback
      );
    }
    return fallback;
  };

  const normalizeOptionValues = (value) => {
    const payload = getCatalogPayload(value);
    if (!Array.isArray(payload)) return [];

    const seen = new Set();
    return payload
      .map((item) => getCatalogText(item).trim())
      .filter((label) => {
        if (!label || seen.has(label)) return false;
        seen.add(label);
        return true;
      });
  };

  const normalizeCatalogItems = (value) => {
    const payload = getCatalogPayload(value);
    if (!Array.isArray(payload)) return [];
    return payload.map((item) => ({
      id: item?._id || item?.id || getCatalogText(item).trim(),
      name: getCatalogText(item).trim(),
    })).filter((item) => item.name);
  };

  const mergeOptionValues = (...groups) => {
    const seen = new Set();
    return groups
      .flat()
      .map((item) => getCatalogText(item).trim())
      .filter((label) => {
        if (!label || seen.has(label)) return false;
        seen.add(label);
        return true;
      });
  };

  const mergeGroupedOptionValues = (...groups) => {
    const merged = {};
    groups.forEach((group) => {
      if (!group || typeof group !== "object") return;
      Object.entries(group).forEach(([key, values]) => {
        const groupName = getCatalogText(key).trim();
        if (!groupName) return;
        merged[groupName] = mergeOptionValues(merged[groupName] || [], Array.isArray(values) ? values : []);
      });
    });
    return merged;
  };

  const withSelectedOption = (options, selected) => mergeOptionValues(options, selected ? [selected] : []);

  const normalizeGroupedOptionValues = (value, groupKey) => {
    const payload = getCatalogPayload(value);
    const grouped = {};

    const addOption = (group, option) => {
      const groupLabel = getCatalogText(group).trim();
      const optionLabel = getCatalogText(option).trim();
      if (!groupLabel || !optionLabel) return;
      grouped[groupLabel] = grouped[groupLabel] || [];
      if (!grouped[groupLabel].includes(optionLabel)) {
        grouped[groupLabel].push(optionLabel);
      }
    };

    if (Array.isArray(payload)) {
      payload.forEach((item) => addOption(item?.[groupKey], item));
      return grouped;
    }

    if (payload && typeof payload === "object") {
      Object.entries(payload).forEach(([group, options]) => {
        (Array.isArray(options) ? options : []).forEach((option) => addOption(group, option));
      });
    }

    return grouped;
  };

  const normalizeGroupedCatalogItems = (value, groupKey) => {
    const payload = getCatalogPayload(value);
    const grouped = {};
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return grouped;
    Object.entries(payload).forEach(([group, options]) => {
      grouped[group] = (Array.isArray(options) ? options : []).map((option) => ({
        id: option?._id || option?.id || `${group}:${getCatalogText(option)}`,
        name: getCatalogText(option).trim(),
        [groupKey]: getCatalogText(option?.[groupKey], group).trim(),
      })).filter((item) => item.name);
    });
    return grouped;
  };

  const normalizeProductForState = (product, fallback = {}) => {
    const category = getCatalogText(product.category, fallback.category || "");
    const productType = getCatalogText(product.product_type || product.type, fallback.product_type || fallback.type || "");
    const productName = getCatalogText(product.product_name || product.name, fallback.product_name || fallback.name || "");
    const variant = getCatalogText(product.variant, fallback.variant || "");
    const type = productType;

    return {
      ...product,
      id: product._id || product.id || fallback.id,
      name: productName,
      product_type: productType,
      product_name: productName,
      category,
      variant,
      type,
      price:
        product.price ||
        `₱${(product.unit_price || fallback.unit_price || 0).toLocaleString()}`,
      image: resolveProductImage(product),
    };
  };

  const [productTypesList, setProductTypesList] = useState([]);
  const [productTypeCatalogItems, setProductTypeCatalogItems] = useState([]);
  const [categoryOptionsList, setCategoryOptionsList] = useState([]);
  const [categoryCatalogItems, setCategoryCatalogItems] = useState([]);
  const [variantsList, setVariantsList] = useState({});
  const [variantCatalogItems, setVariantCatalogItems] = useState({});
  const catalogLoadVersionRef = useRef(0);

  const reloadCatalogLists = async () => {
    const requestVersion = ++catalogLoadVersionRef.current;
    const [types, categories, vars] = await Promise.allSettled([
      catalogApi.getTypes(),
      catalogApi.getCategories(),
      catalogApi.getVariants(),
    ]);
    if (requestVersion !== catalogLoadVersionRef.current) return;

    if (types.status === "fulfilled") {
      const items = normalizeCatalogItems(types.value);
      setProductTypeCatalogItems(items);
      setProductTypesList(items.map((item) => item.name));
    } else {
      console.error("Failed to load product types", types.reason);
    }

    if (categories.status === "fulfilled") {
      const items = normalizeCatalogItems(categories.value);
      setCategoryCatalogItems(items);
      setCategoryOptionsList(items.map((item) => item.name));
    } else {
      console.error("Failed to load categories", categories.reason);
    }

    if (vars.status === "fulfilled") {
      setVariantsList(normalizeGroupedOptionValues(vars.value, "product_type"));
      setVariantCatalogItems(normalizeGroupedCatalogItems(vars.value, "product_type"));
    } else {
      console.error("Failed to load variants", vars.reason);
    }
  };

  const saveCatalogOption = async (kind, name) => {
    if (kind === "types") await catalogApi.createType({ name });
    if (kind === "names") await catalogApi.createName({ name, product_type: newProduct.product_type });
    if (kind === "categories") await catalogApi.createCategory({ name });
    if (kind === "variants") {
      const productType = newProduct.product_type.trim();
      if (!productType) throw new Error("Select a Product Type before adding a variant.");
      await catalogApi.createVariant({ name, product_type: productType });
    }

    if (kind === "types") {
      setProductTypesList((current) => mergeOptionValues(current, [name]));
    }
    if (kind === "categories") {
      setCategoryOptionsList((current) => mergeOptionValues(current, [name]));
    }
    if (kind === "variants") {
      const productType = newProduct.product_type.trim();
      setVariantsList((current) => ({
        ...current,
        [productType]: mergeOptionValues(current[productType] || [], [name]),
      }));
    }

    await reloadCatalogLists();
    return name;
  };

  const editCatalogOption = async (kind, item, name) => {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Name is required.");
    const id = item.id || item._id;
    if (!id) throw new Error("This catalog item cannot be edited because it has no record ID.");
    let response;
    if (kind === "types") response = await catalogApi.updateType(id, { name: cleanName });
    if (kind === "categories") response = await catalogApi.updateCategory(id, { name: cleanName });
    if (kind === "variants") response = await catalogApi.updateVariant(id, { name: cleanName, product_type: item.product_type || newProduct.product_type });
    const savedName = getCatalogText(response?.item?.name).trim() || cleanName;
    const matchesItem = (entry) => String(entry.id || entry._id) === String(id);

    if (kind === "types") {
      setProductTypeCatalogItems((current) => current.map((entry) => matchesItem(entry) ? { ...entry, name: savedName } : entry));
      setProductTypesList((current) => current.map((value) => value === item.name ? savedName : value));
    }
    if (kind === "categories") {
      setCategoryCatalogItems((current) => current.map((entry) => matchesItem(entry) ? { ...entry, name: savedName } : entry));
      setCategoryOptionsList((current) => current.map((value) => value === item.name ? savedName : value));
    }
    if (kind === "variants") {
      const group = item.product_type || newProduct.product_type;
      setVariantCatalogItems((current) => ({
        ...current,
        [group]: (current[group] || []).map((entry) => matchesItem(entry) ? { ...entry, name: savedName } : entry),
      }));
      setVariantsList((current) => ({
        ...current,
        [group]: (current[group] || []).map((value) => value === item.name ? savedName : value),
      }));
    }
    if (kind === "types" && newProduct.product_type === item.name) {
      setNewProduct((product) => ({ ...product, product_type: savedName }));
    }
    if (kind === "types") {
      setProducts((current) => current.map((product) => product.product_type === item.name
        ? { ...product, product_type: savedName, type: savedName }
        : product));
    }
    if (kind === "categories" && newProduct.category === item.name) {
      setNewProduct((product) => ({ ...product, category: savedName }));
    }
    if (kind === "categories") {
      setProducts((current) => current.map((product) => product.category?.toLowerCase() === item.name.toLowerCase()
        ? { ...product, category: savedName.toLowerCase() }
        : product));
    }
    if (kind === "variants" && newProduct.variant === item.name) {
      setNewProduct((product) => ({ ...product, variant: savedName }));
    }
    if (kind === "variants") {
      setProducts((current) => current.map((product) => product.variant === item.name && product.product_type === (item.product_type || newProduct.product_type)
        ? { ...product, variant: savedName }
        : product));
    }
    return savedName;
  };

  const deleteCatalogOption = async (kind, item) => {
    const id = item.id || item._id;
    if (!id) throw new Error("This catalog item cannot be deleted because it has no record ID.");
    if (kind === "types") await catalogApi.deleteType(id);
    if (kind === "categories") await catalogApi.deleteCategory(id);
    if (kind === "variants") await catalogApi.deleteVariant(id, item.product_type || newProduct.product_type);
    await reloadCatalogLists();
    if (kind === "types" && newProduct.product_type === item.name) {
      setNewProduct((product) => ({ ...product, product_type: "", product_name: "", variant: "" }));
    }
    if (kind === "categories" && newProduct.category === item.name) {
      setNewProduct((product) => ({ ...product, category: "" }));
    }
    if (kind === "variants" && newProduct.variant === item.name) {
      setNewProduct((product) => ({ ...product, variant: "" }));
    }
  };

  useEffect(() => {
    reloadCatalogLists();
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  const INITIAL_NEW_PRODUCT = {
    name: "",
    product_type: "",
    product_name: "",
    pricing_method: "",
    category: "",
    variant: "",
    base_price: "",
    price_per_sqft: "",
    price_per_blade: "",
    blade_glass_types: [],
    piece_options: [],
    area_options: [],
    sell_blades_only: true,
    sell_with_frame: false,
    blade_frame_types: [],
    allow_custom_frame_size: false,
    custom_frame_size_unit: "in",
    custom_frame_price: "",
    minimum_blades: 1,
    maximum_blades: "",
    customer_can_choose_blade_count: false,
    default_blade_glass_type: "",
    default_sale_mode: "blades_only",
    default_frame_type: "",
    show_price_per_blade: true,
    customization: false,
    customization_fee: 0,
    extra_charges: [],
    size_limits: { min_width: "", max_width: "", min_height: "", max_height: "", unit: "in" },
    standard_size: "",
    finished_door_pricing: { enabled: false, measurement_dimension: "height", standard_size_cm: 190, standard_price_per_piece: "", additional_price_per_cm: "" },
    unit_price: "",
    width: "",
    height: "",
    unit: "in",
    blade_count: "",
    estimated_area: 0,
    estimated_price: 0,
    estimated_price_override: "",
    images: {},
    description: "",
    is_active: true,
  };

  const [newProduct, setNewProduct] = useState(INITIAL_NEW_PRODUCT);

  const [editingProduct, setEditingProduct] =
    useState(null);

  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const canAddProducts = isAdmin || hasStaffModulePermission(user, "product_management", "add");
  const canEditProducts = isAdmin || hasStaffModulePermission(user, "product_management", "edit");
  const canDeleteProducts = isAdmin || hasStaffModulePermission(user, "product_management", "delete");

  const [modalError, setModalError] =
    useState("");

  const [uploadProgress, setUploadProgress] = useState({});
  const [uploading, setUploading] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [uploadCanceled, setUploadCanceled] = useState(false);
  const uploadRequestRef = useRef(null);
  const saveProductRequestRef = useRef(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    const width = parseFloat(newProduct.width) || 0;
    const height = parseFloat(newProduct.height) || 0;
    const sqftPrice = parseFloat(newProduct.price_per_sqft) || 0;
    const bladeCount = parseInt(newProduct.blade_count, 10) || 0;
    const bladePrice = parseFloat(newProduct.price_per_blade) || 0;
    const basePrice = parseFloat(newProduct.base_price) || 0;
    const defaultFrame = (newProduct.blade_frame_types || []).find((frame) => frame.name === newProduct.default_frame_type);
    const defaultBladeCount = newProduct.default_sale_mode === "frame"
      ? Number(defaultFrame?.blade_count) || Number(newProduct.minimum_blades) || 1
      : Number(newProduct.minimum_blades) || 1;

    const result = newProduct.pricing_method === "fixed"
      ? { estimated_area: 0 }
      : calculateEstimate({
      productName: newProduct.product_name || newProduct.name,
      categoryKey: newProduct.product_type || newProduct.category,
      variantName: newProduct.variant,
      width,
      height,
      quantity: 1,
      measurementUnit: newProduct.unit,
      blade_count: bladeCount,
      base_price: basePrice,
      overrideRate: sqftPrice > 0
        ? sqftPrice
        : (newProduct.pricing_method === 'blade' ? bladePrice : undefined),
      });

    const estimatedPrice = getProductLineTotal({
      pricing_method: newProduct.pricing_method,
      base_price: basePrice,
      price_per_sqft: sqftPrice,
      price_per_blade: bladePrice,
      blade_count: bladeCount,
      blade_glass_types: newProduct.blade_glass_types || [],
      piece_options: newProduct.piece_options || [],
      area_options: newProduct.area_options || [],
      sell_blades_only: newProduct.sell_blades_only !== false,
      sell_with_frame: Boolean(newProduct.sell_with_frame),
      blade_frame_types: newProduct.blade_frame_types || [],
      allow_custom_frame_size: Boolean(newProduct.allow_custom_frame_size),
      custom_frame_price: Number(newProduct.custom_frame_price) || 0,
      minimum_blades: Number(newProduct.minimum_blades) || 1,
      maximum_blades: Number(newProduct.maximum_blades) || 0,
      customer_can_choose_blade_count: Boolean(newProduct.customer_can_choose_blade_count),
      default_blade_glass_type: newProduct.default_blade_glass_type || newProduct.blade_glass_types?.[0]?.name || "",
      default_sale_mode: newProduct.default_sale_mode || "blades_only",
      default_frame_type: newProduct.default_frame_type || newProduct.blade_frame_types?.[0]?.name || "",
      show_price_per_blade: newProduct.show_price_per_blade !== false,
      extra_charges: newProduct.extra_charges,
      measurement_unit: newProduct.unit,
    }, {
      width,
      height,
      quantity: 1,
      measurement_unit: newProduct.unit,
      customized: true,
      blade_glass_type: newProduct.default_blade_glass_type || newProduct.blade_glass_types?.[0]?.name || "",
      piece_option: "",
      piece_options: newProduct.piece_options || [],
      area_option: newProduct.area_options?.[0]?.name || "",
      area_options: newProduct.area_options || [],
      sale_mode: newProduct.default_sale_mode || "blades_only",
      frame_type: newProduct.default_frame_type || newProduct.blade_frame_types?.[0]?.name || "",
      custom_frame_size: newProduct.default_sale_mode === "frame" && !defaultFrame && Boolean(newProduct.allow_custom_frame_size),
      extra_charges: getDefaultExtraChargeSelections({ extra_charges: newProduct.extra_charges || [] }),
      blade_count: defaultBladeCount,
    });

    setNewProduct((prev) => {
      if (prev.estimated_area === result.estimated_area && prev.estimated_price === estimatedPrice) {
        return prev;
      }
      return {
        ...prev,
        estimated_area: result.estimated_area,
        estimated_price: estimatedPrice,
      };
    });
  }, [
    newProduct.pricing_method,
    newProduct.width,
    newProduct.height,
    newProduct.price_per_sqft,
    newProduct.blade_count,
    newProduct.price_per_blade,
    newProduct.blade_glass_types,
    newProduct.piece_options,
    newProduct.area_options,
    newProduct.sell_blades_only,
    newProduct.sell_with_frame,
    newProduct.blade_frame_types,
    newProduct.allow_custom_frame_size,
    newProduct.custom_frame_size_unit,
    newProduct.custom_frame_price,
    newProduct.minimum_blades,
    newProduct.maximum_blades,
    newProduct.customer_can_choose_blade_count,
    newProduct.default_blade_glass_type,
    newProduct.default_sale_mode,
    newProduct.default_frame_type,
    newProduct.show_price_per_blade,
    newProduct.unit,
    newProduct.base_price,
    newProduct.product_name,
    newProduct.product_type,
    newProduct.variant,
    newProduct.extra_charges,
  ]);

  const uploaderSections = [
    ["main", "Main Photo"],
    ["left", "Left Angle"],
    ["right", "Right Angle"],
    ["top", "Top Angle"],
    ["bottom", "Back Angle"],
  ];

  const rowsPerPage = 12;

  const filteredProducts = products.filter((product) => {
    const normalizedSearch = search.toLowerCase();
    const matchSearch =
      String(product.name || product.product_name || "").toLowerCase().includes(normalizedSearch) ||
      String(product.description || "").toLowerCase().includes(normalizedSearch) ||
      String(product.category || "").toLowerCase().includes(normalizedSearch) ||
      String(product.variant || "").toLowerCase().includes(normalizedSearch);

    const matchCategory =
      categoryFilter === "All"
        ? true
        : String(product.category || "").trim().toLowerCase() === categoryFilter.trim().toLowerCase();

    const productType = String(product.product_type || product.type || "").trim();

    const matchType =
      typeFilter === "All"
        ? true
        : productType.toLowerCase() === typeFilter.toLowerCase();

    const matchStatus =
      statusFilter === "All"
        ? true
        : statusFilter === "Active"
        ? product.is_active === true
        : product.is_active === false;

    return matchSearch && matchCategory && matchType && matchStatus;
  });

  const lastIndex =
    currentPage * rowsPerPage;

  const firstIndex =
    lastIndex - rowsPerPage;

  const currentProducts = isMobile
    ? filteredProducts
    : filteredProducts.slice(
      firstIndex,
      lastIndex
    );

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / rowsPerPage));
  const firstShown = filteredProducts.length === 0 ? 0 : firstIndex + 1;
  const lastShown = Math.min(lastIndex, filteredProducts.length);

  const toggleProductStatus = async (product) => {
    try {
      const updated = await updateProductApi(product.id, {
        is_active: !product.is_active,
      });
      const payload = updated.product || updated;
      recordActivity(
        user,
        `${payload.is_active ? "Activated" : "Deactivated"} product ${product.id}.`,
        "Products",
      );
      setProducts((current) =>
        current.map((item) =>
          item.id === product.id || item._id === product.id
            ? normalizeProductForState({ ...item, ...payload }, item)
            : item
        )
      );
    } catch (error) {
      console.error("Failed to update product status", error);
    }
  };

  const toggleFeaturedProduct = async (product) => {
    if (!canEditProducts) return;
    try {
      const updated = await updateProductApi(product.id, {
        is_featured: !product.is_featured,
      });
      const payload = updated.product || updated;
      setProducts((current) =>
        current.map((item) =>
          item.id === product.id || item._id === product.id
            ? normalizeProductForState({ ...item, ...payload }, item)
            : item
        )
      );
      recordActivity(
        user,
        `${payload.is_featured ? "Featured" : "Removed from featured products"} ${product.product_name || product.name}.`,
        "Products",
      );
      toast.success(payload.is_featured ? "Product marked as Top Product." : "Product removed from Top Products.");
    } catch (error) {
      console.error("Failed to update featured product status", error);
    }
  };

  useEffect(() => {
    const loadProducts = async () => {
      try {
        const data = await getProducts({ adminOnly: isAdmin });
        const loadedProducts = (data.products || [])
          .map((product) => normalizeProductForState(product))
          .filter(isRenderableProduct);
        setProducts(loadedProducts);
      } catch (error) {
        console.error("Failed to load products", error);
      }
    };

    loadProducts();
    const unsubscribeRealtime = subscribeToRealtime(["products", "catalog"], loadProducts);
    return unsubscribeRealtime;
  }, [isAdmin]);

    const openModal = (product = null) => {
      setModalError("");
      if (!(product ? canEditProducts : canAddProducts)) {
        setModalError("Your account does not have permission to manage this product.");
        return;
      }
      void reloadCatalogLists();
      if (product) {
        const safeProduct = normalizeProductForState(product);
        const bladeGlassTypes = Array.isArray(product.blade_glass_types) && product.blade_glass_types.length
          ? product.blade_glass_types.map((glass) => ({ ...glass }))
          : Number(product.price_per_blade || product.unit_price) > 0
            ? [{ name: "Standard", price_per_blade: Number(product.price_per_blade || product.unit_price) }]
            : [];
        const isFinishedDoor = /finished\s*door/i.test([safeProduct.product_type, safeProduct.product_name, safeProduct.name].filter(Boolean).join(" "));
        const editPricingMethod = product.pricing_method || (isFinishedDoor ? "per_piece" : PRICING_METHOD[safeProduct.product_name || safeProduct.name] || "");
        const editJalousieBlade = editPricingMethod === "blade" && /jalousie/i.test(safeProduct.product_name || safeProduct.name || "");
        const editFrameTypes = Array.isArray(product.blade_frame_types) ? product.blade_frame_types.map((frame) => ({ ...frame })) : [];
        const editSellWithFrame = Boolean(product.sell_with_frame) && (!editJalousieBlade || editFrameTypes.some((frame) => String(frame.name || "").trim()));
        const editSellBladesOnly = product.sell_blades_only !== false || (editJalousieBlade && !editFrameTypes.some((frame) => String(frame.name || "").trim()));
        const editDefaultSaleMode = editJalousieBlade
          && product.default_sale_mode === "frame"
          && !editFrameTypes.some((frame) => frame.name === product.default_frame_type)
          && editSellBladesOnly
          ? "blades_only"
          : product.default_sale_mode || "blades_only";
        setEditingProduct(product);
        setNewProduct({
          name: safeProduct.name || "",
          product_type: safeProduct.product_type || safeProduct.type || "",
          product_name: safeProduct.product_name || safeProduct.name || "",
          pricing_method: editPricingMethod,
          category: product.category || "",
          variant: safeProduct.variant || "",
          base_price: product.base_price || (product.pricing_method === "per_meter" ? "" : product.unit_price) || "",
          unit_price: product.unit_price ?? "",
          price_per_sqft: product.price_per_sqft ?? "",
          price_per_blade: product.price_per_blade ?? "",
          blade_glass_types: bladeGlassTypes,
          piece_options: Array.isArray(product.piece_options) ? product.piece_options.map((option) => ({ ...option })) : [],
          area_options: Array.isArray(product.area_options) ? product.area_options.map((option) => ({ ...option })) : [],
          sell_blades_only: editSellBladesOnly,
          sell_with_frame: editSellWithFrame,
          blade_frame_types: editFrameTypes,
          allow_custom_frame_size: !editJalousieBlade && Boolean(product.allow_custom_frame_size),
          custom_frame_size_unit: product.custom_frame_size_unit || "in",
          custom_frame_price: editJalousieBlade ? "" : product.custom_frame_price ?? "",
          minimum_blades: product.minimum_blades ?? 1,
          maximum_blades: product.maximum_blades ?? "",
          customer_can_choose_blade_count: Boolean(product.customer_can_choose_blade_count),
          default_blade_glass_type: product.default_blade_glass_type || bladeGlassTypes[0]?.name || "",
          default_sale_mode: editDefaultSaleMode,
          default_frame_type: product.default_frame_type || "",
          show_price_per_blade: product.show_price_per_blade !== false,
          customization: product.customization || false,
          customization_fee: product.customization_fee ?? 0,
          extra_charges: Array.isArray(product.extra_charges) ? product.extra_charges.map((charge) => ({ ...charge })) : [],
          size_limits: editJalousieBlade
            ? { min_width: "", max_width: "", min_height: "", max_height: "", unit: product.measurement_unit || "in" }
            : { min_width: "", max_width: "", min_height: "", max_height: "", unit: product.measurement_unit || "in", ...(product.size_limits || {}) },
          standard_size: editJalousieBlade ? "" : product.standard_size || "",
          finished_door_pricing: isFinishedDoor ? {
            ...(product.finished_door_pricing || {}),
            enabled: editPricingMethod === "per_piece",
            measurement_dimension: product.finished_door_pricing?.measurement_dimension || "height",
            standard_size_cm: Number(product.finished_door_pricing?.standard_size_cm) || 190,
            standard_price_per_piece: Number(product.finished_door_pricing?.standard_price_per_piece) || Number(product.base_price) || Number(product.unit_price) || "",
            additional_price_per_cm: Number(product.finished_door_pricing?.additional_price_per_cm) || 0,
          } : product.finished_door_pricing || { enabled: false, measurement_dimension: "height", standard_size_cm: 190, standard_price_per_piece: "", additional_price_per_cm: "" },
          width: editJalousieBlade ? "" : product.width ?? "",
          height: editJalousieBlade ? "" : product.height ?? "",
          unit: product.measurement_unit || "in",
          blade_count: product.blade_count ?? "",
          estimated_area: product.estimated_area ?? 0,
          estimated_price: product.estimated_price ?? 0,
          estimated_price_override: Number(product.estimated_price_override) > 0 ? String(product.estimated_price_override) : "",
          images: product.images || {},
          imageFiles: {},
          description: product.description || "",
          is_active: product.is_active !== undefined ? product.is_active : true,
        });
      } else {
        setEditingProduct(null);
        setNewProduct({ ...INITIAL_NEW_PRODUCT, imageFiles: {} });
      }
      setShowModal(true);
    };

  const closeModal = () => {
    setShowModal(false);
    setEditingProduct(null);
    setModalError("");
  };

  const handleCreateNewProduct = () => {
    // Reuse openModal logic for consistent admin check and modal behavior
    openModal(null);
  };

  // Upload image files using multipart/form-data and real XHR progress tracking
  const uploadImages = async () => {
    if (!newProduct.imageFiles) return { success: true, files: [] };

    const fileKeys = Object.keys(newProduct.imageFiles).filter((key) => newProduct.imageFiles[key]);
    if (fileKeys.length === 0) return { success: true, files: [] };

    const controller = new AbortController();
    uploadRequestRef.current = controller;
    setUploadCanceled(false);
    setUploading(true);
    setUploadProgress(fileKeys.reduce((acc, key) => ({ ...acc, [key]: 0 }), {}));
    try {
      const result = await uploadFiles(
        fileKeys.map((key) => newProduct.imageFiles[key]),
        (percent) => setUploadProgress(Object.fromEntries(fileKeys.map((key) => [key, percent]))),
        { purpose: "product-images", fieldNames: fileKeys, signal: controller.signal },
      );
      setUploadProgress(Object.fromEntries(fileKeys.map((key) => [key, 100])));
      setTimeout(() => setUploadProgress({}), 700);
      return result;
    } catch (error) {
      if (controller.signal.aborted) return { aborted: true };
      throw error;
    } finally {
      setUploading(false);
      uploadRequestRef.current = null;
    }
  };

  const cancelUpload = () => {
    if (uploadRequestRef.current) {
      uploadRequestRef.current.abort();
    }
  };

  const saveProduct = async () => {
    if (saveProductRequestRef.current) return;
    if (!(editingProduct ? canEditProducts : canAddProducts)) {
      setModalError("Your account does not have permission to save this product.");
      return;
    }

    const productName = newProduct.product_name.trim() || "Unnamed Product";
    const variant = newProduct.variant.trim();
    const selectedProductType = newProduct.product_type.trim();
    const selectedCategory = newProduct.category.trim();
    const existingImages = normalizeImageMap(newProduct.images);
    const hasMainImage = Boolean(existingImages.main || newProduct.imageFiles?.main);
    const pricingMethod = newProduct.pricing_method || (
      Number(newProduct.price_per_sqft) > 0
        ? "sqft"
        : Number(newProduct.price_per_blade) > 0
        ? "blade"
        : ""
    );
    const isJalousiePerBladeProduct = pricingMethod === "blade"
      && /jalousie/i.test(productName);
    const defaultSaleMode = isJalousiePerBladeProduct
      && newProduct.default_sale_mode === "frame"
      && !(newProduct.blade_frame_types || []).some((frame) => frame.name === newProduct.default_frame_type)
      && newProduct.sell_blades_only
      ? "blades_only"
      : newProduct.default_sale_mode || (newProduct.sell_blades_only ? "blades_only" : "frame");

    if (!selectedProductType) {
      setModalError("Product type is required.");
      return;
    }

    if (!newProduct.product_name.trim()) {
      setModalError("Product name is required.");
      return;
    }

    if (!selectedCategory) {
      setModalError("Category is required.");
      return;
    }

    if (!variant && !editingProduct && pricingMethod !== "blade") {
      setModalError("Variant is required.");
      return;
    }

    if (!hasMainImage) {
      setModalError("Main product photo is required.");
      return;
    }

    if (!pricingMethod) {
      setModalError("Enter valid pricing details before saving.");
      return;
    }

    if (pricingMethod === "sqft") {
      const w = parseFloat(newProduct.width);
      const h = parseFloat(newProduct.height);
      if (!w || !h || w <= 0 || h <= 0) {
        setModalError("Width and height must be greater than 0.");
        return;
      }
      if (Number(newProduct.price_per_sqft) <= 0 && !(newProduct.area_options || []).length) {
        setModalError("Price per sq ft is required.");
        return;
      }
      const configuredAreaOptions = newProduct.area_options || [];
      if (configuredAreaOptions.some((option) => {
        const optionPrice = String(option.price_per_sqft ?? "").trim();
        return !String(option.name || "").trim()
          || (optionPrice && (!Number.isFinite(Number(option.price_per_sqft)) || Number(option.price_per_sqft) <= 0));
      })) {
        setModalError("Each area option needs a name, and any entered price must be greater than zero.");
        return;
      }
      if (new Set(configuredAreaOptions.map((option) => String(option.name || "").trim().toLowerCase())).size !== configuredAreaOptions.length) {
        setModalError("Area option names must be unique.");
        return;
      }
    }

    if (pricingMethod === "per_meter" && (Number(newProduct.width) <= 0 || Number(newProduct.unit_price) <= 0)) {
      setModalError("Length and price per meter must be greater than 0.");
      return;
    }

    const finishedDoorEnabled = /finished\s*door/i.test(`${selectedProductType} ${productName}`) && newProduct.finished_door_pricing?.enabled;
    if (finishedDoorEnabled && (pricingMethod !== "per_piece"
      || !Number.isFinite(Number(newProduct.finished_door_pricing?.standard_size_cm)) || Number(newProduct.finished_door_pricing?.standard_size_cm) <= 0
      || String(newProduct.finished_door_pricing?.standard_price_per_piece ?? "").trim() === "" || !Number.isFinite(Number(newProduct.finished_door_pricing?.standard_price_per_piece)) || Number(newProduct.finished_door_pricing?.standard_price_per_piece) < 0
      || String(newProduct.finished_door_pricing?.additional_price_per_cm ?? "").trim() === "" || !Number.isFinite(Number(newProduct.finished_door_pricing?.additional_price_per_cm)) || Number(newProduct.finished_door_pricing?.additional_price_per_cm) < 0)) {
      setModalError("Enter a positive standard size and valid non-negative Finished Door prices.");
      return;
    }

    const configuredPieceOptions = newProduct.piece_options || [];
    if (pricingMethod === "per_piece" && !finishedDoorEnabled && Number(newProduct.base_price) <= 0 && !configuredPieceOptions.length) {
      setModalError("Price per piece must be greater than 0.");
      return;
    }

    if (pricingMethod === "per_piece" && configuredPieceOptions.some((option) => !String(option.name || "").trim() || !Number.isFinite(Number(option.price_per_piece)) || Number(option.price_per_piece) <= 0)) {
      setModalError("Each option needs a name and a price per piece greater than zero.");
      return;
    }
    if (pricingMethod === "per_piece" && new Set(configuredPieceOptions.map((option) => String(option.name || "").trim().toLowerCase())).size !== configuredPieceOptions.length) {
      setModalError("Option names must be unique.");
      return;
    }

    if (pricingMethod === "blade") {
      const glassTypes = newProduct.blade_glass_types || [];
      if (!glassTypes.length || glassTypes.some((glass) => !String(glass.name || "").trim() || Number(glass.price_per_blade) <= 0)) {
        setModalError("Add at least one glass type with a price per blade greater than zero.");
        return;
      }
      if (!newProduct.sell_blades_only && !newProduct.sell_with_frame) {
        setModalError("Enable at least one selling option: blades only or blades with frame.");
        return;
      }
      if (newProduct.sell_with_frame && !newProduct.blade_frame_types?.length && (isJalousiePerBladeProduct || !newProduct.allow_custom_frame_size)) {
        setModalError("Add a frame type or enable custom frame size.");
        return;
      }
      if ((newProduct.blade_frame_types || []).some((frame) => !String(frame.name || "").trim() || Number(frame.blade_count) < 1 || !Number.isFinite(Number(frame.price)) || Number(frame.price) < 0)) {
        setModalError("Each frame type needs a name, blade count, and valid frame price.");
        return;
      }
      if (!isJalousiePerBladeProduct && newProduct.allow_custom_frame_size && Number(newProduct.custom_frame_price) <= 0) {
        setModalError("Custom frame price must be greater than zero.");
        return;
      }
      const minimumBlades = Math.max(1, Number(newProduct.minimum_blades) || 1);
      const maximumBlades = Number(newProduct.maximum_blades) || 0;
      if (maximumBlades > 0 && maximumBlades < minimumBlades) {
        setModalError("Maximum blades cannot be lower than minimum blades.");
        return;
      }
      const largestFrameBladeCount = Math.max(0, ...(newProduct.blade_frame_types || []).map((frame) => Number(frame.blade_count) || 0));
      if (maximumBlades > 0 && largestFrameBladeCount > maximumBlades) {
        setModalError("Maximum blades cannot be lower than the blade count of any frame type.");
        return;
      }
      const defaultGlass = newProduct.default_blade_glass_type || glassTypes[0]?.name;
      if (!glassTypes.some((glass) => glass.name === defaultGlass)) {
        setModalError("Choose a default glass type from the configured glass types.");
        return;
      }
      if ((defaultSaleMode === "blades_only" && !newProduct.sell_blades_only) || (defaultSaleMode === "frame" && !newProduct.sell_with_frame)) {
        setModalError("Choose a default selling option that is enabled.");
        return;
      }
      if (defaultSaleMode === "frame" && newProduct.blade_frame_types.length && !newProduct.blade_frame_types.some((frame) => frame.name === newProduct.default_frame_type)) {
        setModalError("Choose a default frame type from the configured frame types.");
        return;
      }
      if (defaultSaleMode === "frame" && !newProduct.blade_frame_types.length && (isJalousiePerBladeProduct || !newProduct.allow_custom_frame_size)) {
        setModalError("Choose a default frame type or enable custom frame size.");
        return;
      }
    }

    if (pricingMethod === "fixed" && !editingProduct) {
      if (!newProduct.base_price) {
        setModalError("Base price is required for fixed price products.");
        return;
      }
    }

    for (const charge of newProduct.extra_charges || []) {
      if (!String(charge.name || "").trim() || String(charge.amount ?? "").trim() === "" || !Number.isFinite(Number(charge.amount)) || Number(charge.amount) < 0) {
        setModalError("Each extra charge needs a name and a valid amount.");
        return;
      }
      if (!["fixed", "per_sqft", "per_blade", "percentage"].includes(charge.type)) {
        setModalError("Choose a valid calculation type for each extra charge.");
        return;
      }
    }

    const limits = newProduct.size_limits || {};
    const hasInvalidSizeLimits = (Number(limits.min_width) > 0 && Number(limits.max_width) > 0 && Number(limits.min_width) > Number(limits.max_width))
      || (Number(limits.min_height) > 0 && Number(limits.max_height) > 0 && Number(limits.min_height) > Number(limits.max_height));
    if (!isJalousiePerBladeProduct && hasInvalidSizeLimits) {
      setModalError("A minimum size cannot be greater than its maximum.");
      return;
    }

    const numberIfEntered = (value) => (value === "" || value == null ? undefined : Number(value));

    saveProductRequestRef.current = true;
    setSavingProduct(true);
    setModalError("");

    try {
      // If there are local files, upload them and replace previews with server URLs
      let finalImages = existingImages;
      if (newProduct.imageFiles && Object.keys(newProduct.imageFiles).length > 0) {
        const uploaded = await uploadImages();
        if (uploaded && uploaded.aborted) {
          setModalError("Upload canceled.");
          return;
        }
        if (uploaded && uploaded.files) {
          const mapping = {};
          uploaded.files.forEach((f) => { mapping[f.key] = f.url; });
          finalImages = normalizeImageMap({ ...finalImages, ...mapping });
          setNewProduct((prev) => ({ ...prev, images: finalImages, imageFiles: {} }));
        }
      }
      const payload = {
        // Backend compatibility fields
        name: productName,
        sku: "",
        unit_price: pricingMethod === "per_meter"
          ? Number(newProduct.unit_price) || 0
          : pricingMethod === "per_piece"
            ? Number(newProduct.estimated_price_override) || (finishedDoorEnabled ? Number(newProduct.finished_door_pricing?.standard_price_per_piece) : 0) || Number(newProduct.base_price) || Number(newProduct.unit_price) || Number(newProduct.estimated_price) || 0
            : Number(newProduct.estimated_price_override) || (pricingMethod === "sqft" ? Number(newProduct.price_per_sqft) : 0) || Number(newProduct.estimated_price) || Number(newProduct.finished_door_pricing?.standard_price_per_piece) || Number(newProduct.base_price) || Number(newProduct.price_per_sqft) || Number(newProduct.price_per_blade) || 0,
        unit: pricingMethod === "sqft" ? "per_sqft" : pricingMethod === "blade" ? "per_blade" : pricingMethod === "per_meter" ? "per_meter" : "per_piece",
        measurement_unit: newProduct.unit || "in",
        image_url: finalImages.main || "",
        product_type: selectedProductType,
        product_name: newProduct.product_name || productName,
        pricing_method: pricingMethod,
        category: selectedCategory,
        variant,
        base_price: finishedDoorEnabled ? Number(newProduct.finished_door_pricing?.standard_price_per_piece) || 0 : numberIfEntered(newProduct.base_price),
        price_per_sqft: numberIfEntered(newProduct.price_per_sqft),
        price_per_blade: pricingMethod === "blade"
          ? Number(newProduct.blade_glass_types?.find((glass) => glass.name === (newProduct.default_blade_glass_type || newProduct.blade_glass_types?.[0]?.name))?.price_per_blade) || 0
          : numberIfEntered(newProduct.price_per_blade),
        customization: Boolean(newProduct.customization),
        customization_fee: Number(newProduct.customization_fee) || 0,
        extra_charges: (newProduct.extra_charges || []).map((charge) => ({
          name: String(charge.name || "").trim(),
          type: charge.type || "fixed",
          amount: Number(charge.amount) || 0,
          is_active: charge.is_active !== false,
          is_optional: Boolean(charge.is_optional),
          is_default_selected: false,
        })),
        size_limits: isJalousiePerBladeProduct ? {} : {
          min_width: Number(newProduct.size_limits?.min_width) || 0,
          max_width: Number(newProduct.size_limits?.max_width) || 0,
          min_height: Number(newProduct.size_limits?.min_height) || 0,
          max_height: Number(newProduct.size_limits?.max_height) || 0,
          unit: newProduct.size_limits?.unit || newProduct.unit || "in",
        },
        standard_size: isJalousiePerBladeProduct ? "" : newProduct.standard_size || "",
        finished_door_pricing: {
          enabled: Boolean(newProduct.finished_door_pricing?.enabled),
          measurement_dimension: newProduct.finished_door_pricing?.measurement_dimension || "height",
          standard_size_cm: Number(newProduct.finished_door_pricing?.standard_size_cm),
          standard_price_per_piece: Number(newProduct.finished_door_pricing?.standard_price_per_piece),
          additional_price_per_cm: Number(newProduct.finished_door_pricing?.additional_price_per_cm),
        },
        width: isJalousiePerBladeProduct ? 0 : numberIfEntered(newProduct.width),
        height: isJalousiePerBladeProduct ? 0 : numberIfEntered(newProduct.height),
        blade_count: numberIfEntered(newProduct.blade_count),
        blade_glass_types: (newProduct.blade_glass_types || []).map((glass) => ({ name: String(glass.name || "").trim(), price_per_blade: Number(glass.price_per_blade) || 0 })),
        piece_options: (newProduct.piece_options || []).map((option) => ({ name: String(option.name || "").trim(), price_per_piece: Number(option.price_per_piece) || 0 })),
        area_options: (newProduct.area_options || []).map((option) => ({ name: String(option.name || "").trim(), price_per_sqft: Number(option.price_per_sqft) || 0 })),
        sell_blades_only: Boolean(newProduct.sell_blades_only),
        sell_with_frame: Boolean(newProduct.sell_with_frame),
        blade_frame_types: (newProduct.blade_frame_types || []).map((frame) => ({ name: String(frame.name || "").trim(), blade_count: Number(frame.blade_count) || 0, price: Number(frame.price) || 0 })),
        allow_custom_frame_size: !isJalousiePerBladeProduct && Boolean(newProduct.allow_custom_frame_size),
        custom_frame_size_unit: newProduct.custom_frame_size_unit || newProduct.unit || "in",
        custom_frame_price: isJalousiePerBladeProduct ? 0 : Number(newProduct.custom_frame_price) || 0,
        minimum_blades: Math.max(1, Number(newProduct.minimum_blades) || 1),
        maximum_blades: Number(newProduct.maximum_blades) || 0,
        customer_can_choose_blade_count: Boolean(newProduct.customer_can_choose_blade_count),
        default_blade_glass_type: newProduct.default_blade_glass_type || newProduct.blade_glass_types?.[0]?.name || "",
        default_sale_mode: defaultSaleMode,
        default_frame_type: newProduct.default_frame_type || "",
        show_price_per_blade: newProduct.show_price_per_blade !== false,
        estimated_area: Number(newProduct.estimated_area) || 0,
        estimated_price: Number(newProduct.estimated_price_override) || Number(newProduct.estimated_price) || 0,
        estimated_price_override: Number(newProduct.estimated_price_override) || 0,
        images: finalImages,
        description: newProduct.description,
        is_active: newProduct.is_active,
      };

      if (editingProduct) {
        const updated = await updateProductApi(editingProduct.id, payload);
        const product = updated.product || updated;
        setProducts((current) =>
          current.map((item) =>
            item.id === editingProduct.id || item._id === editingProduct.id
              ? normalizeProductForState({ ...item, ...product }, item)
              : item
          )
        );
        recordActivity(user, `Updated product ${productName}.`, "Products");
        toast.success("Product updated successfully.");
      } else {
        const created = await createProductApi(payload);
        const product = created.product || created;
        setProducts((current) => {
          const normalizedProduct = normalizeProductForState(product);
          const createdId = normalizedProduct.id || normalizedProduct._id;
          if (current.some((item) => item.id === createdId || item._id === createdId)) return current;
          return [normalizedProduct, ...current];
        });
        recordActivity(user, `Created product ${productName}.`, "Products");
        toast.success("Product added successfully.");
      }

      closeModal();
    } catch (error) {
      console.error("Save product failed", error);
      setModalError(
        error.data?.message || error.message || "Unable to save product."
      );
    } finally {
      saveProductRequestRef.current = false;
      setSavingProduct(false);
    }
  };

  const deleteProduct = async (id) => {
    if (!canDeleteProducts) {
      toast.error("Your account does not have permission to delete products.");
      return;
    }
    try {
      await deleteProductApi(id);
      const deletedProduct = products.find((product) => product.id === id || product._id === id);
      recordActivity(user, `Deleted product ${deletedProduct?.product_name || id}.`, "Products");
      setProducts((current) =>
        current.filter((product) => product._id !== id && product.id !== id)
      );
    } catch (error) {
      console.error("Delete product failed", error);
    }
  };

  const openDeleteConfirm = (product) => {
    if (!canDeleteProducts) return;
    setProductToDelete(product);
    setDeleteConfirmOpen(true);
  };

  const closeDeleteConfirm = () => {
    setProductToDelete(null);
    setDeleteConfirmOpen(false);
    setDeleteLoading(false);
  };

  const confirmDeleteProduct = async () => {
    if (!productToDelete) return;
    setDeleteLoading(true);
    try {
      await deleteProduct(productToDelete._id || productToDelete.id);
      closeDeleteConfirm();
    } catch (error) {
      console.error("Delete product failed", error);
      setDeleteLoading(false);
    }
  };

  const getProductType = (product) => {
    return String(product.product_type || product.type || "").trim();
  };

  const productTypeOptions = withSelectedOption(productTypesList, newProduct.product_type);
  const productTypeFilterOptions = mergeOptionValues(
    productTypesList,
    products.map((product) => String(product.product_type || product.type || "").trim()).filter(Boolean),
  );
  const categoryOptions = withSelectedOption(categoryOptionsList, newProduct.category);
  const productCategoryFilterOptions = mergeOptionValues(
    categoryOptionsList,
    products.map((product) => String(product.category || "").trim()).filter(Boolean),
  );
  const variantOptions = withSelectedOption(
    variantsList[newProduct.product_type] || [],
    newProduct.variant
  );
  return (
    <div className={`flex h-screen overflow-hidden ${darkMode ? "bg-slate-950" : "bg-[#f8f3f2]"}`}>
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />

      <div className="flex-1 min-h-0 flex flex-col">

        <Navbar />

        <main className={`min-h-0 flex-1 overflow-y-auto px-4 py-3 !pb-[calc(10rem+env(safe-area-inset-bottom))] sm:px-6 sm:!pb-[calc(10rem+env(safe-area-inset-bottom))] lg:!pb-24 ${darkMode ? "text-slate-100" : ""}`}>

          <AdminPageHeader
            title="Product Management"
            description="Glass & Aluminum Business · Admin Panel"
            className={`!rounded-2xl !px-5 !py-4 shadow-[0_4px_18px_rgba(15,23,42,0.06)] ${darkMode ? "!bg-slate-900 !text-white" : "!bg-none bg-white"}`}
            statsClassName="grid-cols-1 lg:grid-cols-4 gap-2"
            stats={[
              { label: "Total Products", value: products.length, color: "text-red-800" },
              { label: "Active", value: products.filter((product) => product.is_active).length, color: "text-emerald-600" },
              { label: "Inactive", value: products.filter((product) => !product.is_active).length, color: "text-slate-500" },
              { label: "Showing", value: filteredProducts.length, color: "text-indigo-600" },
            ]}
          />

          {/* FILTERS */}
            <div className={`mt-4 rounded-2xl border p-2 shadow-[0_4px_16px_rgba(15,23,42,0.04)] sm:p-2.5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>

              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_repeat(3,minmax(120px,160px))] lg:items-center">
                <div className="relative w-full min-w-0">
                  <Search
                    size={16}
                    className="absolute left-3 top-2.5 text-gray-400"
                  />
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={search}
                    onChange={(e) =>
                      setSearch(e.target.value)
                    }
                    className={`h-9 w-full rounded-xl border py-1.5 pl-10 pr-3 text-xs outline-none ${darkMode ? "border-slate-700 bg-slate-800 text-white placeholder:text-slate-400" : "border-slate-200 bg-white text-slate-900"}`}
                  />
                </div>
                <button
                  onClick={() => openModal()}
                  disabled={!canAddProducts}
                  className={`inline-flex h-9 items-center justify-center rounded-xl px-3 text-xs font-semibold text-white shadow-sm transition ${canAddProducts ? "bg-red-600 hover:bg-red-700" : "bg-gray-300 cursor-not-allowed"}`}
                >
                  <Plus size={16} className="mr-1.5" />
                  Add Product
                </button>
                <FilterDropdown
                  label="All Types"
                  value={typeFilter}
                  onChange={setTypeFilter}
                  darkMode={darkMode}
                  options={[
                    ["All", "All Types"],
                    ...productTypeFilterOptions.map((option) => [option, option]),
                  ]}
                />

                <FilterDropdown
                  label="All Categories"
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  darkMode={darkMode}
                  options={[
                    ["All", "All Categories"],
                    ...productCategoryFilterOptions.map((option) => [option, capitalizeFirstLetter(option)]),
                  ]}
                />

                <FilterDropdown
                  label="All Status"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  darkMode={darkMode}
                  options={[
                    ["All", "All Status"],
                    ["Active", "Active"],
                    ["Inactive", "Inactive"],
                  ]}
                />
              </div>
              {!isAdmin && (
                <p className="mt-2 text-sm text-yellow-700">
                  Product creation and editing are available only to admin users.
                </p>
              )}

            </div>

          {/* PRODUCTS */}

              <div className="mt-6">
                {currentProducts.length === 0 ? (
                  <div className={`rounded-3xl p-10 text-center shadow ${darkMode ? "border border-slate-700 bg-slate-900" : "bg-white"}`}>
                    <p className={darkMode ? "text-slate-400" : "text-gray-500"}>No products match the selected filters.</p>
                  </div>
                ) : (
                  <div className="admin-product-list grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-[18px]">
                    {currentProducts.map((product) => {
                      const imageSrc = resolveProductImage(product);
                      const productName = product.product_name || product.name || "Unnamed Product";
                      const productType = product.product_type || product.type || "General";
                      const estimatedCost = getProductEstimatedCost(product);
                      const productWidth = Number(product.width) || 0;
                      const productHeight = Number(product.height) || 0;
                      const productAreaSqft = toSquareFeet(productWidth, productHeight, product.measurement_unit || "in");
                      const pricingMethod = product.pricing_method || PRICING_METHOD[product.product_name] || "";
                      const hasConfiguredBladePricing = pricingMethod === "blade" && (product.blade_glass_types?.length || product.blade_frame_types?.length);
                      const hasEstimatedCostOverride = pricingMethod === "fixed"
                        && Number(product.estimated_price_override) > 0;
                      const unitPriceLabel = pricingMethod === "sqft" && Number(product.estimated_price_override) <= 0 && productAreaSqft > 0 && estimatedCost > 0
                        ? `₱${(Number(product.price_per_sqft) || estimatedCost / productAreaSqft).toLocaleString("en-PH", { maximumFractionDigits: 2 })} / sq ft`
                        : getProductPriceLabel(product);
                      const productDimensions = pricingMethod === "blade"
                        ? ""
                        : pricingMethod === "per_meter" && productWidth > 0
                        ? `${productWidth.toLocaleString()} ${product.measurement_unit || "m"}`
                        : productWidth > 0 && productHeight > 0
                        ? `${productWidth.toLocaleString()} × ${productHeight.toLocaleString()} ${product.measurement_unit || "in"}`
                        : product.standard_size || "";
                      return (
                        <article key={product._id || product.id} className={`admin-product-card group flex h-full flex-col overflow-hidden rounded-2xl border transition duration-150 hover:-translate-y-0.5 ${product.is_featured ? "border-amber-400 hover:border-amber-500 glow-bar-amber" : darkMode ? "border-slate-700 hover:border-slate-500" : "border-slate-200 hover:border-slate-400"} ${darkMode ? "bg-slate-900" : "bg-white"} motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:transform-none`}>
                          <div className={`admin-product-image relative aspect-[4/3] overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                            <img
                              src={imageSrc}
                              alt={productName}
                              className="h-full w-full object-cover"
                              onError={(event) => {
                                event.currentTarget.onerror = null;
                                event.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                              }}
                            />
                            {product.is_featured && (
                              <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-amber-500 bg-amber-300 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-amber-950">
                                <Star size={12} fill="currentColor" aria-hidden="true" /> Top Product
                              </span>
                            )}
                            <div className="absolute bottom-3 right-3 z-10 flex gap-1.5">
                              <button
                                type="button"
                                disabled={!canEditProducts}
                                className={`inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? product.is_featured ? "border-amber-400 bg-amber-300 text-amber-950 hover:border-amber-300 hover:bg-amber-400" : "border-slate-700 bg-slate-900 text-slate-400 hover:border-amber-400 hover:text-amber-300" : product.is_featured ? "border-amber-500 bg-amber-50 text-amber-600 hover:bg-amber-100" : "border-slate-300 bg-white text-slate-500 hover:border-amber-400 hover:text-amber-600"}`}
                                onClick={() => toggleFeaturedProduct(product)}
                                title={product.is_featured ? "Remove from Top Products" : "Make Top Product"}
                                aria-label={`${product.is_featured ? "Remove from Top Products" : "Make Top Product"}: ${productName}`}
                                aria-pressed={Boolean(product.is_featured)}
                              >
                                <Star size={17} fill={product.is_featured ? "currentColor" : "none"} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={!canEditProducts}
                                className={`inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-amber-800/70 bg-slate-900 text-amber-300 hover:border-amber-500 hover:bg-amber-950/60 hover:text-amber-200" : "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100 hover:text-amber-800"}`}
                                onClick={() => openModal(product)}
                                title="Edit product"
                                aria-label={`Edit product: ${productName}`}
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                disabled={!canDeleteProducts}
                                className={`inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-red-900/70 bg-slate-900 text-red-300 hover:border-red-500 hover:bg-red-950/60 hover:text-red-200" : "border-red-200 bg-red-50 text-red-700 hover:border-red-400 hover:bg-red-100 hover:text-red-800"}`}
                                onClick={() => openDeleteConfirm(product)}
                                title="Delete product"
                                aria-label={`Delete product: ${productName}`}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                          <div className="admin-product-details flex flex-1 flex-col gap-3 p-4">
                            <div>
                              <span className={`inline-flex max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] ${darkMode ? "border-slate-700 bg-slate-800 text-red-300" : "border-slate-200 bg-slate-50 text-red-700"}`}>
                                {product.category || "General"}
                              </span>
                              <h3 title={productName} className={`mt-2 truncate text-[17px] font-medium ${darkMode ? "text-white" : "text-slate-900"}`}>{productName}</h3>
                              <p className={`mt-1 truncate text-[13px] font-normal ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{productType}{pricingMethod !== "blade" && product.variant ? ` · ${product.variant}` : ""}</p>
                            </div>
                            <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                              <div>
                                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
                                  {Number(product.estimated_price_override) > 0 ? "Override EST. Cost" : "Est. Cost"}
                                </p>
                                <p className={`mt-0.5 whitespace-nowrap text-[21px] font-medium ${darkMode ? "text-red-300" : "text-red-700"}`}>
                                  ₱{estimatedCost.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                              </div>
                              <div className={`max-w-[48%] min-w-0 text-right text-xs ${darkMode ? "text-slate-400" : "text-slate-600"}`}>
                                {productDimensions && <p className="truncate" title={productDimensions}>{productDimensions}</p>}
                                <p className="whitespace-normal break-words leading-4" title={unitPriceLabel}>{unitPriceLabel}</p>
                              </div>
                            </div>
                          </div>
                          <footer className={`admin-product-status flex items-center justify-between gap-3 border-t px-4 py-2.5 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                            <span className={`flex min-w-0 items-center gap-2 truncate text-xs font-normal ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                              <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${product.is_active ? "bg-emerald-500" : "bg-slate-400"}`} aria-hidden="true" />
                              {product.is_active ? "Active product" : "Inactive product"}
                            </span>
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* PAGINATION */}
              <div className={`${isMobile ? "hidden" : "mt-6 flex flex-col items-center justify-center gap-3 border-t p-4 sm:flex-row"} ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-gray-50"}`}>
                <span className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  Showing {firstShown}-{lastShown} of {filteredProducts.length} products
                </span>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    aria-disabled={currentPage === 1}
                    onClick={() => setCurrentPage(currentPage - 1)}
                    className={`h-10 rounded-lg border px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border bg-white text-slate-700 hover:bg-gray-100"}`}
                  >
                    Previous
                  </button>
                  {[...Array(totalPages)].map((_, index) => (
                    <button
                      key={index}
                      aria-current={currentPage === index + 1 ? "page" : undefined}
                      onClick={() => setCurrentPage(index + 1)}
                      className={`h-10 w-10 rounded-lg ${
                        currentPage === index + 1
                          ? "bg-red-600 text-white"
                          : darkMode ? "border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border bg-white text-slate-700 hover:bg-gray-100"
                      }`}
                    >
                      {index + 1}
                    </button>
                  ))}
                  <button
                    disabled={currentPage === totalPages}
                    aria-disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(currentPage + 1)}
                    className={`h-10 rounded-lg border px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border bg-white text-slate-700 hover:bg-gray-100"}`}
                  >
                    Next
                  </button>
                </div>
              </div>
        </main>
      </div>

      <AppToaster />

      {showModal && (
        <ProductFormModal
          editingProduct={editingProduct}
          newProduct={newProduct}
          setNewProduct={setNewProduct}
          productTypeOptions={productTypeOptions}
          categoryOptions={categoryOptions}
          variantOptions={variantOptions}
          productTypeCatalogItems={productTypeCatalogItems}
          categoryCatalogItems={categoryCatalogItems}
          variantCatalogItems={variantCatalogItems}
          pricingMethodByName={PRICING_METHOD}
          uploaderSections={uploaderSections}
          uploadProgress={uploadProgress}
          uploading={uploading}
          saving={savingProduct}
          modalError={modalError}
          saveProduct={saveProduct}
          closeModal={closeModal}
          cancelUpload={cancelUpload}
          saveCatalogOption={saveCatalogOption}
          editCatalogOption={editCatalogOption}
          deleteCatalogOption={deleteCatalogOption}
          canAddProducts={canAddProducts}
          canEditProducts={canEditProducts}
          canDeleteProducts={canDeleteProducts}
        />
      )}

      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-xl font-semibold mb-3">Confirm Delete</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete <strong>{productToDelete?.product_name || productToDelete?.name}</strong>?
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={closeDeleteConfirm}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteProduct}
                disabled={deleteLoading}
                className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {deleteLoading ? "Deleting..." : "Delete product"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default Products;
