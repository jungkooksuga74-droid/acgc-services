import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  X,
  ArrowRight,
  ShoppingBag,
  ShoppingCart,
  Search,
  Package,
  BriefcaseBusiness,
  ShieldCheck,
  Clock3,
  Wrench,
  Truck,
  Ruler,
  LoaderCircle,
  Star,
  StarHalf,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleX,
  Mail,
  Phone,
  MapPin,
} from "lucide-react";
import toast from "react-hot-toast";
import AppToaster from "@/components/AppToaster";
import OrderProgressTimeline from "@/components/OrderProgressTimeline";
import FilterDropdown from "@/components/FilterDropdown";
import AboutBusinessContent from "@/components/AboutBusinessContent";
import ProductPriceEstimator from "@/components/ProductPriceEstimator";
import ProductSpecifications, { getProductDimensionsLabel } from "@/components/ProductSpecifications";
import CustomerDropdown from "@/components/CustomerDropdown";
import { getProductEstimatorState } from "@/components/ProductPriceEstimator";
import { getProductEstimatorQuantityError } from "@/lib/productEstimatorQuantity";
import { useAuth } from "@/contexts/AuthContext";
import { getCart, saveCart } from "@/api/cart";
import { getPaymentSummary } from "@/pages/Transactions/paymentProofUtils";
import { getPaymentStatusBadgeClassName, getPaymentStatusLabel, statusBadgeBaseClassName } from "@/lib/statusBadgeStyles";
import { getProducts } from "../../api/products";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import { getCustomerFeedbackSummary, getProductReviewSummaries, getProductReviews, trackOrder } from "../../api/orders";
import { trackRepairRequest } from "@/api/repairs";
import OrderRepairProgress from "@/components/OrderRepairProgress";
import logo from "../../assets/images/ACGCLOGO1.png";
import { calculateEstimate } from "@/lib/estimator";
import { getFinalProjectCost } from "@/lib/orderPricing";
import { resolveBackendImageUrl } from "../../lib/resolveBackendImageUrl";
import { buildProductPriceSnapshot, getDefaultBladeCount, getDefaultExtraChargeSelections, getDefaultProductLineTotal, getProductLineTotal } from "@/lib/productPricing";
import { clearPendingProductAction, savePendingProductAction } from "@/lib/pendingProductAction";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useCustomerPermissions } from "@/hooks/useCustomerPermissions";
import { useAdminContactPhone } from "@/hooks/useAdminContactPhone";
import { getOptimizedProductImageUrl, getProductImageSource, getProductImageSrcSet, handleProductImageError, handleProductImageLoad, PRODUCT_IMAGE_PLACEHOLDER } from "@/lib/productImageUtils";

const createLandingCartId = () => globalThis.crypto?.randomUUID?.()
  || `landing-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function LandingScrollCue({ reduceMotion, targetId, label = "Scroll down to more content" }) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) {
      setIsVisible(false);
      return undefined;
    }

    const updateVisibility = () => {
      setIsVisible(target.getBoundingClientRect().top >= window.innerHeight);
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);
    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [targetId]);

  if (!isVisible) return null;

  return (
    <div className="mt-8 flex justify-center">
      <button
        type="button"
        onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" })}
        aria-label={label}
        title={label}
        className="inline-flex h-14 w-14 items-center justify-center rounded-full border-2 border-red-100 bg-white text-red-700 shadow-[0_8px_24px_rgba(220,38,38,0.24)] ring-4 ring-red-400/20 transition duration-200 hover:-translate-y-1 hover:scale-105 hover:bg-red-50 hover:text-red-800 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300 motion-reduce:transition-none"
      >
        <ChevronDown size={30} strokeWidth={3} aria-hidden="true" className={reduceMotion ? "" : "animate-bounce"} />
      </button>
    </div>
  );
}

function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const { user, loading: authLoading } = useAuth();
  const customerPermissions = useCustomerPermissions();
  const canSeeCustomerRatings = customerPermissions.show_ratings_homepage;
  const isMobile = useIsMobile();
  const {
    phone: adminContactPhone,
    phoneHref: adminContactPhoneHref,
    address: adminContactAddress,
    addressHref: adminContactAddressHref,
    email: adminContactEmail,
    emailHref: adminContactEmailHref,
  } = useAdminContactPhone();
  const initialSearchParams = new URLSearchParams(location.search);
  const lastLocationSearchRef = useRef(location.search);
  const restoringLocationStateRef = useRef(false);
  const pushSectionHistoryRef = useRef(false);
  const resumedPendingCartActionRef = useRef("");
  const handleAddToCartRef = useRef(null);
  const validSections = ["home", "products", "about", "track-order"];
  const [active, setActive] = useState(() => {
    const section = initialSearchParams.get("section");
    return validSections.includes(section) ? section : "home";
  });
  const [showHeroScrollArrow, setShowHeroScrollArrow] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedProductReviews, setSelectedProductReviews] = useState([]);
  const [selectedProductReviewsLoading, setSelectedProductReviewsLoading] = useState(false);
  const [selectedLandingReviewRatingTab, setSelectedLandingReviewRatingTab] = useState(0);
  const [landingReviewPhotoPreview, setLandingReviewPhotoPreview] = useState(null);
  const [showLoginRequired, setShowLoginRequired] = useState(false);
  const [pendingGuestCartAdd, setPendingGuestCartAdd] = useState(null);
  const [pendingGuestOrderActionId, setPendingGuestOrderActionId] = useState("");
  const [loginRequiredAction, setLoginRequiredAction] = useState("cart");
  const [addingCartProductId, setAddingCartProductId] = useState("");
  const [productEstimatorForm, setProductEstimatorForm] = useState({ unit: "in", width: "0", height: "0", quantity: 1, blade_glass_type: "", sale_mode: "blades_only", frame_type: "", custom_frame_size: false, blade_count: 1 });
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [productSearch, setProductSearch] = useState(() => initialSearchParams.get("q") || "");
  const [productCategory, setProductCategory] = useState(() => initialSearchParams.get("category") || "All");
  const [productType, setProductType] = useState(() => initialSearchParams.get("type") || "All");
  const [productPage, setProductPage] = useState(() => Math.max(1, Number(initialSearchParams.get("page")) || 1));
  const [productsPerPage, setProductsPerPage] = useState(() => {
    const requestedValue = initialSearchParams.get("perPage");
    if (requestedValue === "all") return 0;
    const requested = Number(requestedValue);
    return [4, 8, 12, 16].includes(requested) ? requested : 8;
  });
  const [featuredProductStats, setFeaturedProductStats] = useState({});
  const [featuredRatingStats, setFeaturedRatingStats] = useState({
    average: 0,
    total: 0,
    counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  });
  const [isLoadingFeatured, setIsLoadingFeatured] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [featuredError, setFeaturedError] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingResult, setTrackingResult] = useState(null);
  const [repairTrackingResult, setRepairTrackingResult] = useState(null);
  const [trackingError, setTrackingError] = useState("");
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [showAllTrackedItems, setShowAllTrackedItems] = useState(false);
  const [pendingActionError, setPendingActionError] = useState("");

  useEffect(() => {
    if (active !== "home") {
      setShowHeroScrollArrow(false);
      return undefined;
    }

    const heroSection = document.getElementById("home");
    const featuredSection = document.getElementById("featured-products");
    if (!heroSection || !featuredSection || typeof IntersectionObserver === "undefined") {
      setShowHeroScrollArrow(true);
      return undefined;
    }

    let heroIsVisible = true;
    let featuredIsVisible = false;
    setShowHeroScrollArrow(true);

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === heroSection) heroIsVisible = entry.isIntersecting;
        if (entry.target === featuredSection) {
          featuredIsVisible = entry.isIntersecting && entry.intersectionRatio >= 0.2;
        }
      });
      setShowHeroScrollArrow(heroIsVisible && !featuredIsVisible);
    }, { threshold: [0, 0.2] });

    observer.observe(heroSection);
    observer.observe(featuredSection);
    return () => observer.disconnect();
  }, [active]);

  const ratedLandingReviews = selectedProductReviews.filter((review) => Number(review.rating) >= 1 && Number(review.rating) <= 5);
  const landingReviewAverage = ratedLandingReviews.length
    ? ratedLandingReviews.reduce((sum, review) => sum + Number(review.rating), 0) / ratedLandingReviews.length
    : 0;
  const landingReviewCounts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: ratedLandingReviews.filter((review) => Number(review.rating) === star).length,
  }));
  const filteredLandingReviews = selectedLandingReviewRatingTab === 0
    ? selectedProductReviews
    : selectedProductReviews.filter((review) => Number(review.rating) === selectedLandingReviewRatingTab);
  useEffect(() => {
    if (lastLocationSearchRef.current === location.search) return;
    lastLocationSearchRef.current = location.search;
    restoringLocationStateRef.current = true;
    const params = new URLSearchParams(location.search);
    const section = params.get("section");
    setActive(validSections.includes(section) ? section : "home");
    setProductSearch(params.get("q") || "");
    setProductCategory(params.get("category") || "All");
    setProductType(params.get("type") || "All");
    setProductPage(Math.max(1, Number(params.get("page")) || 1));
    const requestedPageSize = Number(params.get("perPage"));
    setProductsPerPage([4, 8, 12, 16].includes(requestedPageSize) ? requestedPageSize : 8);
  }, [location.search]);

  useEffect(() => {
    if (restoringLocationStateRef.current) {
      restoringLocationStateRef.current = false;
      pushSectionHistoryRef.current = false;
      return;
    }
    const params = new URLSearchParams(location.search);
    if (params.get("section") !== active) {
      if (active === "home") params.delete("section");
      else params.set("section", active);
    }
    if (productSearch.trim()) params.set("q", productSearch.trim());
    else params.delete("q");
    if (productCategory !== "All") params.set("category", productCategory);
    else params.delete("category");
    if (productType !== "All") params.set("type", productType);
    else params.delete("type");
    if (productPage > 1) params.set("page", String(productPage));
    else params.delete("page");
    if (productsPerPage !== 8) params.set("perPage", productsPerPage === 0 ? "all" : String(productsPerPage));
    else params.delete("perPage");

    const nextSearch = params.toString();
    if (nextSearch !== location.search.replace(/^\?/, "")) {
      const replace = !pushSectionHistoryRef.current;
      pushSectionHistoryRef.current = false;
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash}`, { replace });
    } else {
      pushSectionHistoryRef.current = false;
    }
  }, [active, location.hash, location.pathname, location.search, navigate, productCategory, productPage, productSearch, productType, productsPerPage]);

  const trackingPaymentSummary = trackingResult ? getPaymentSummary(trackingResult) : null;
  const scrollToSection = (sectionId) => {
    if (sectionId !== active) pushSectionHistoryRef.current = true;
    setActive(sectionId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const isBladeProduct = (product) => {
    const method = String(product?.pricing_method || product?.unit || "").toLowerCase();
    return method ? ["blade", "per_blade"].includes(method) : /jalousie/i.test(product?.product_name || product?.name || "");
  };
  const isAreaProduct = (product) => ["sqft", "per_sqft", "area", "per_area"].includes(String(product?.pricing_method || product?.unit || "").toLowerCase());

  const normalizeBrowseProduct = (product) => {
    if (!product || !isBladeProduct(product) || !/jalousie/i.test(product.product_name || product.name || "")) return product;
    const frames = Array.isArray(product.blade_frame_types) ? product.blade_frame_types : [];
    const hasConfiguredFrame = frames.some((frame) => String(frame.name || "").trim());
    const sellWithFrame = Boolean(product.sell_with_frame) && hasConfiguredFrame;
    const sellBladesOnly = product.sell_blades_only !== false || !sellWithFrame;
    return {
      ...product,
      pricing_method: product.pricing_method || "blade",
      width: 0,
      height: 0,
      dimensions: "",
      standard_size: "",
      size_limits: {},
      allow_custom_frame_size: false,
      custom_frame_price: 0,
      sell_blades_only: sellBladesOnly,
      sell_with_frame: sellWithFrame,
      default_sale_mode: sellWithFrame && product.default_sale_mode === "frame" ? "frame" : "blades_only",
      default_frame_type: sellWithFrame ? product.default_frame_type || frames[0]?.name || "" : "",
    };
  };

  const getDefaultBladeSelections = (product) => {
    product = normalizeBrowseProduct(product);
    const glassTypes = Array.isArray(product?.blade_glass_types) ? product.blade_glass_types : [];
    const frameTypes = Array.isArray(product?.blade_frame_types) ? product.blade_frame_types : [];
    const defaultFrame = frameTypes.find((frame) => frame.name === product?.default_frame_type) || frameTypes[0];
    const sellBladesOnly = product?.sell_blades_only !== false;
    const defaultSaleMode = product?.default_sale_mode || (sellBladesOnly ? "blades_only" : "frame");
    const saleMode = defaultSaleMode === "frame" && !product?.sell_with_frame ? "blades_only" : defaultSaleMode;

    const defaultBladeCount = saleMode === "frame"
      ? Number(defaultFrame?.blade_count) || Number(product?.minimum_blades) || 1
      : Number(product?.minimum_blades) || Number(product?.blade_count) || 1;

    return {
      blade_glass_type: product?.default_blade_glass_type || glassTypes[0]?.name || "",
      piece_option: "",
      area_option: "",
      sale_mode: saleMode,
      frame_type: defaultFrame?.name || "",
      custom_frame_size: saleMode === "frame" && frameTypes.length === 0 && Boolean(product?.allow_custom_frame_size),
      blade_count: product?.customer_can_choose_blade_count ? "" : defaultBladeCount,
    };
  };

  const openProductDetails = (product) => {
    product = normalizeBrowseProduct(product);
    setSelectedProduct(product);
    const dimensions = getProductDefaultDimensions(product);
    setProductEstimatorForm({
      unit: dimensions.unit || "in",
      width: String(dimensions.width || 0),
      height: String(dimensions.height || 0),
      quantity: 1,
      ...getDefaultBladeSelections(product),
    });
  };

  const handleFeaturedProductClick = (product) => {
    scrollToSection("products");
    openProductDetails(product);
  };

  useEffect(() => {
    const loadFeaturedProducts = async (showInitialLoading = false) => {
      if (showInitialLoading) setIsLoadingFeatured(true);
      setFeaturedError("");

      try {
        const response = await getProducts();
        const activeProducts = (response.products || []).filter((product) => product.is_active !== false);

        setCatalogProducts(activeProducts);
        setFeaturedProducts(activeProducts.slice(0, 3));
        setCatalogLoaded(true);
        // Product cards only depend on the catalog response. Don't keep the
        // whole grid in its loading state while review summaries are fetched.
        setIsLoadingFeatured(false);

        const reviewSummaryResponse = await getProductReviewSummaries(
          activeProducts.map((product) => product._id || product.id).filter(Boolean),
        ).catch(() => ({ summaries: {} }));
        const stats = {};
        activeProducts.forEach((product) => {
          const productId = product._id || product.id;
          const summary = reviewSummaryResponse.summaries?.[productId];
          if (!productId) return;
          stats[productId] = {
            averageRating: Number(summary?.average) || 0,
            ratingsCount: Number(summary?.total) || 0,
          };
        });
        const feedbackSummary = await getCustomerFeedbackSummary().catch(() => null);
        const ratingCounts = [5, 4, 3, 2, 1].reduce((counts, star) => {
          counts[star] = Math.max(0, Number(feedbackSummary?.counts?.[star]) || 0);
          return counts;
        }, {});
        const totalRatings = [5, 4, 3, 2, 1].reduce((sum, star) => sum + ratingCounts[star], 0);
        const weightedRatingTotal = [5, 4, 3, 2, 1].reduce((sum, star) => sum + ratingCounts[star] * star, 0);
        setCatalogProducts(activeProducts);
        setFeaturedProductStats(stats);
        setFeaturedRatingStats({
          average: totalRatings ? weightedRatingTotal / totalRatings : 0,
          total: totalRatings,
          counts: ratingCounts,
        });
      } catch (error) {
        console.error("Failed to load featured products", error);
        setCatalogProducts([]);
        setFeaturedProducts([]);
        setCatalogLoaded(true);
        setFeaturedProductStats({});
        setFeaturedRatingStats({ average: 0, total: 0, counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
        setFeaturedError(
          error?.data?.message || error?.message || "Failed to load featured products."
        );
      } finally {
        setIsLoadingFeatured(false);
      }
    };

    loadFeaturedProducts(true);
    const unsubscribeRealtime = subscribeToRealtime(
      ["products", "catalog", "reviews"],
      () => loadFeaturedProducts(false),
    );
    return unsubscribeRealtime;
  }, []);

  useEffect(() => {
    if (!selectedProduct) return undefined;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        if (landingReviewPhotoPreview) setLandingReviewPhotoPreview(null);
        else setSelectedProduct(null);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedProduct, landingReviewPhotoPreview]);

  useEffect(() => {
    const productId = selectedProduct?._id || selectedProduct?.id;
    setSelectedLandingReviewRatingTab(0);
    setLandingReviewPhotoPreview(null);
    if (!productId || !canSeeCustomerRatings || !customerPermissions.can_upload_feedback) {
      setSelectedProductReviews([]);
      setSelectedProductReviewsLoading(false);
      return undefined;
    }

    let active = true;
    setSelectedProductReviewsLoading(true);
    getProductReviews(productId)
      .then((response) => {
        if (active) setSelectedProductReviews(response.reviews || []);
      })
      .catch(() => {
        if (active) setSelectedProductReviews([]);
      })
      .finally(() => {
        if (active) setSelectedProductReviewsLoading(false);
      });

    return () => { active = false; };
  }, [selectedProduct, canSeeCustomerRatings, customerPermissions.can_upload_feedback]);

  const getProductImage = (product, width = 640) => {
    const source = getProductImageSource(product);
    return source ? getOptimizedProductImageUrl(resolveBackendImageUrl(source), width) : "";
  };

  const getProductDefaultDimensions = (product) => {
    if (isBladeProduct(product) && /jalousie/i.test(product?.product_name || product?.name || "")) {
      return { width: 0, height: 0, unit: product?.measurement_unit || "in", quantity: 1, customized: false };
    }
    const dimensionText = String(product?.dimensions || product?.standard_size || product?.size || "");
    const dimensionMatch = dimensionText.match(/(\d+(?:\.\d+)?)\s*(?:x|×|×|by)\s*(\d+(?:\.\d+)?)/i);
    const unitMatch = dimensionText.match(/\b(cm|mm|m|ft|in|inch|inches|feet|meter|meters)\b|"/i);
    const unitMap = { inch: "in", inches: "in", feet: "ft", meter: "m", meters: "m" };

    return {
      width: Number(product?.width) > 0 ? Number(product.width) : dimensionMatch ? Number(dimensionMatch[1]) : 0,
      height: Number(product?.height) > 0 ? Number(product.height) : dimensionMatch ? Number(dimensionMatch[2]) : 0,
      unit: product?.measurement_unit || product?.measurementUnit || (
        unitMatch ? unitMap[unitMatch[1]?.toLowerCase()] || unitMatch[1]?.toLowerCase() || "in" : "in"
      ),
      quantity: 1,
      customized: false,
    };
  };

  const getDefaultCartOptions = (product) => ({
    ...getProductDefaultDimensions(product),
    ...getDefaultBladeSelections(product),
    extra_charges: getDefaultExtraChargeSelections(product),
    useProductDefaults: true,
  });

  const needsProductConfiguration = (product, options) => {
    const method = String(product?.pricing_method || product?.unit || "").toLowerCase();
    const isBlade = ["blade", "per_blade"].includes(method);
    const isMeter = ["meter", "per_meter"].includes(method);
    const isPiece = ["piece", "per_piece", "set", "per_set"].includes(method);
    const width = Number(options.width) || 0;
    const height = Number(options.height) || 0;

    if (isPiece) return false;
    if (isMeter) return width <= 0;
    if (isBlade) {
      const hasGlassOptions = Array.isArray(product.blade_glass_types) && product.blade_glass_types.length > 0;
      const needsCustomFrameDimensions = options.sale_mode === "frame" && Boolean(options.custom_frame_size);
      return (product.customer_can_choose_blade_count && Number(options.blade_count) <= 0)
        || (hasGlassOptions && !options.blade_glass_type)
        || (needsCustomFrameDimensions && (width <= 0 || height <= 0));
    }
    return width <= 0 || height <= 0;
  };

  const buildLandingCartItem = (product, options) => {
    const productId = String(product?._id || product?.id || "");
    const quantity = Math.max(1, Number(options.quantity) || 1);
    const defaults = getProductDefaultDimensions(product, quantity);
    const useProductDefaults = options.useProductDefaults === true;
    const dimensions = {
      width: useProductDefaults ? defaults.width : Number(options.width) || 0,
      height: useProductDefaults ? defaults.height : Number(options.height) || 0,
      unit: options.measurementUnit || options.unit || defaults.unit || "in",
      quantity,
      customized: useProductDefaults
        ? false
        : Boolean(options.customized)
          || Number(options.width) !== defaults.width
          || Number(options.height) !== defaults.height,
    };
    const item = {
      ...product,
      _id: productId,
      product_id: productId,
      name: product.name || product.product_name || "Product",
      image_url: getProductImageSource(product) || product.image_url || "",
      variant: product.variant || product.color || product.variant_name || "",
      quantity,
      unit: product.unit || "piece",
      width: dimensions.width,
      height: dimensions.height,
      measurementUnit: dimensions.unit,
      measurement_unit: dimensions.unit,
      dimensions,
      customized: dimensions.customized,
      notes: options.notes || "",
      blade_glass_type: options.blade_glass_type || product.default_blade_glass_type || "",
      piece_option: options.piece_option ?? "",
      area_option: options.area_option ?? "",
      sale_mode: options.sale_mode || product.default_sale_mode || "blades_only",
      frame_type: options.frame_type || product.default_frame_type || "",
      frame_blade_count: Number(options.frame_blade_count) || 0,
      custom_frame_size: Boolean(options.custom_frame_size),
      blade_count: getDefaultBladeCount(product, { ...options, frame_blade_count: Number(options.frame_blade_count) || 0 }),
      extra_charges: Array.isArray(options.extra_charges)
        ? options.extra_charges
        : getDefaultExtraChargeSelections(product),
      estimated_price: Number(options.estimated_price) || 0,
      is_estimate: dimensions.customized,
    };

    return {
      ...item,
      ...buildProductPriceSnapshot(product, item),
    };
  };

  const getCartProductId = (item) => {
    const productId = item?.product_id || item?._id || item?.id;
    return String(typeof productId === "object" ? productId?._id || productId?.id || "" : productId || "");
  };

  const getCartItemSignature = (item) => JSON.stringify({
    productId: getCartProductId(item),
    variant: item.variant || item.color || "",
    width: Number(item.dimensions?.width ?? item.width) || 0,
    height: Number(item.dimensions?.height ?? item.height) || 0,
    unit: item.dimensions?.unit || item.measurement_unit || item.measurementUnit || "in",
    bladeGlassType: item.blade_glass_type || "",
    saleMode: item.sale_mode || "",
    frameType: item.frame_type || "",
    frameBladeCount: Number(item.frame_blade_count) || 0,
    customFrameSize: Boolean(item.custom_frame_size),
    bladeCount: Number(item.blade_count) || 0,
    extraCharges: (item.extra_charges || [])
      .filter((charge) => charge.is_optional)
      .map((charge) => [charge.name || charge.label || "", charge.is_selected !== false]),
  });

  const handleAddToCart = async (product, options = null) => {
    if (authLoading) {
      toast("Checking your account. Please try again in a moment.");
      return false;
    }
    if (!user) {
      setPendingGuestCartAdd({
        actionId: createLandingCartId(),
        productId: String(product?._id || product?.id || ""),
        product,
        options,
      });
      setPendingGuestOrderActionId("");
      setLoginRequiredAction("cart");
      setShowLoginRequired(true);
      return false;
    }
    if (!customerPermissions.can_request_orders) {
      toast.error("Order requests are currently unavailable.");
      return false;
    }
    if (user.role !== "customer") {
      toast.error("Please log in with a customer account to add products to your cart.");
      return false;
    }

    const cartOptions = options || getDefaultCartOptions(product);
    if (needsProductConfiguration(product, cartOptions)) {
      if (String(selectedProduct?._id || selectedProduct?.id || "") !== String(product._id || product.id || "")) {
        openProductDetails(product);
      }
      toast("Choose the required product options before adding it to your cart.");
      return false;
    }

    const productId = String(product._id || product.id || "");
    if (!productId) {
      toast.error("This product cannot be added to the cart right now.");
      return false;
    }

    setAddingCartProductId(productId);
    try {
      const cartResponse = await getCart();
      const currentItems = Array.isArray(cartResponse.items) ? cartResponse.items : [];
      const cartItem = buildLandingCartItem(product, cartOptions);
      const signature = getCartItemSignature(cartItem);
      const matchingItem = currentItems.find((item) => getCartItemSignature(item) === signature);
      let nextItems;
      let expectedCartId;

      if (matchingItem) {
        const quantity = Math.max(1, Number(matchingItem.quantity) || 1) + cartItem.quantity;
        expectedCartId = String(matchingItem.cartId || createLandingCartId());
        const updatedItem = {
          ...matchingItem,
          cartId: expectedCartId,
          quantity,
          selected: true,
          dimensions: { ...(matchingItem.dimensions || {}), quantity },
        };
        nextItems = currentItems.map((item) => item === matchingItem
          ? { ...updatedItem, ...buildProductPriceSnapshot(product, updatedItem) }
          : item);
      } else {
        expectedCartId = createLandingCartId();
        nextItems = [
          ...currentItems,
          {
            ...cartItem,
            cartId: expectedCartId,
            selected: true,
          },
        ];
      }

      const savedCart = await saveCart(nextItems);
      if (savedCart?.success === false) throw new Error(savedCart.message || "Unable to save your cart.");
      if (Array.isArray(savedCart?.items) && !savedCart.items.some((item) => String(item.cartId || "") === expectedCartId)) {
        throw new Error("The server did not retain this product in your cart. Please try again.");
      }
      toast.success(`${cartItem.name} added to your cart.`);
      return true;
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to add this product to your cart.");
      return false;
    } finally {
      setAddingCartProductId("");
    }
  };

  useEffect(() => {
    handleAddToCartRef.current = handleAddToCart;
  });

  useEffect(() => {
    const pendingCartAdd = location.state?.pendingCartAdd;
    if (
      !pendingCartAdd?.actionId ||
      authLoading ||
      user?.role !== "customer" ||
      !catalogLoaded ||
      resumedPendingCartActionRef.current === pendingCartAdd.actionId
    ) return;

    resumedPendingCartActionRef.current = pendingCartAdd.actionId;
    const clearPendingAction = () => {
      const nextState = { ...(location.state || {}) };
      delete nextState.pendingCartAdd;
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: Object.keys(nextState).length ? nextState : null,
      });
    };
    const product = catalogProducts.find((item) => String(item._id || item.id || "") === pendingCartAdd.productId)
      || pendingCartAdd.product;

    if (!product || !pendingCartAdd.productId) {
      toast.error("We couldn't find that product after login. Please choose it again.");
      clearPendingAction();
      return;
    }

    Promise.resolve(handleAddToCartRef.current?.(product, pendingCartAdd.options || null))
      .finally(clearPendingAction);
  }, [authLoading, catalogLoaded, catalogProducts, location.hash, location.pathname, location.search, location.state, navigate, user?.role]);

  const getProductPrice = (product) => {
    if (!product) return "Contact us";
    if (isBladeProduct(product)) {
      const defaultPrice = getDefaultProductLineTotal(product);
      return defaultPrice > 0
        ? `₱${defaultPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "Contact us";
    }
    if (["per_piece", "piece", "per_set", "set"].includes(String(product.pricing_method || product.unit || "").toLowerCase())) {
      const basePrice = Number(product.estimated_price_override || product.base_price || product.unit_price || product.estimated_price) || 0;
      return basePrice > 0
        ? `₱${basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "Contact us";
    }
    const override = Number(product.estimated_price_override) || 0;
    if (override > 0) {
      const defaultPrice = getProductLineTotal(product, getProductDefaultDimensions(product));
      return `₱${defaultPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (isBladeProduct(product) && product.show_price_per_blade !== false) {
      const glassRates = (product.blade_glass_types || [])
        .map((glass) => Number(glass.price_per_blade) || 0)
        .filter((price) => price > 0);
      const bladeRate = glassRates.length
        ? Math.min(...glassRates)
        : Number(product.price_per_blade || product.unit_price) || 0;
      if (bladeRate > 0) {
        return `₱${bladeRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / blade`;
      }
    }
    const price = getProductLineTotal(product, getProductDefaultDimensions(product));
    return price > 0
      ? `₱${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "Contact us";
  };

  const getProductUnitRate = (product) => {
    const pricePerSqft = Number(product.price_per_sqft) || 0;
    const pricePerBlade = Number(product.price_per_blade) || 0;
    const unitPrice = Number(product.unit_price) || 0;
    const unitKey = product.unit || product.pricing_method || "unit";
    const unitLabels = {
      per_sqft: "sq ft",
      sqft: "sq ft",
      per_blade: "blade",
      blade: "blade",
      per_piece: "piece",
      piece: "piece",
      per_meter: "meter",
      meter: "meter",
      per_set: "set",
      set: "set",
    };
    const label = unitLabels[unitKey] || unitKey;

    if (isBladeProduct(product)) {
      if (product.show_price_per_blade === false) return `Starting from ${getProductPrice(product)}`;
      const glassRates = (product.blade_glass_types || [])
        .map((glass) => Number(glass.price_per_blade) || 0)
        .filter((price) => price > 0);
      const bladeRate = glassRates.length ? Math.min(...glassRates) : pricePerBlade || unitPrice;
      if (bladeRate > 0) return `₱${bladeRate.toLocaleString()} / blade`;
    }

    if ((product.pricing_method === "sqft" || label === "sq ft") && pricePerSqft > 0) {
      return `₱${pricePerSqft.toLocaleString()} / ${label}`;
    }
    if (product.pricing_method === "sqft" && Number(product.area_options?.[0]?.price_per_sqft) > 0) {
      return `Variant from ₱${Number(product.area_options[0].price_per_sqft).toLocaleString()} / item`;
    }
    if ((product.pricing_method === "blade" || label === "blade") && pricePerBlade > 0) {
      return `₱${pricePerBlade.toLocaleString()} / ${label}`;
    }
    if (unitPrice > 0) return `₱${unitPrice.toLocaleString()} / ${label}`;
    return "Contact us";
  };

  const getProductEstimateRate = (product, selections = productEstimatorForm) => {
    const pricingMethod = String(product?.pricing_method || "").toLowerCase();
    const legacyUnit = String(product?.unit || "").toLowerCase();
    if (["per_piece", "piece", "per_set", "set"].includes(pricingMethod || legacyUnit)) {
      return Number(product?.estimated_price_override || product?.base_price || product?.unit_price || product?.estimated_price) || undefined;
    }
    if (pricingMethod === "sqft" || (!pricingMethod && ["per_sqft", "sqft"].includes(legacyUnit))) {
      return Number(product?.price_per_sqft) || undefined;
    }
    if (isBladeProduct(product)) {
      const selectedGlass = (product?.blade_glass_types || []).find(
        (glass) => glass.name === productEstimatorForm.blade_glass_type
      );
      return Number(selectedGlass?.price_per_blade ?? product?.price_per_blade) || undefined;
    }
    return undefined;
  };

  const productCategoryOptions = [...new Set(catalogProducts
    .map((product) => String(product.category || "").trim())
    .filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
  const productTypeOptions = [...new Set(catalogProducts
    .map((product) => String(product.product_type || product.type || "").trim())
    .filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
  const visibleProducts = catalogProducts.filter((product) => {
    const query = productSearch.trim().toLowerCase();
    const matchesSearch = !query || `${product.name || ""} ${product.product_name || ""} ${product.product_type || ""} ${product.category || ""} ${product.description || ""}`
      .toLowerCase().includes(query);
    const matchesCategory = productCategory === "All" || String(product.category || "").toLowerCase() === productCategory.toLowerCase();
    const matchesType = productType === "All" || String(product.product_type || product.type || "").toLowerCase() === productType.toLowerCase();
    return matchesSearch && matchesCategory && matchesType;
  });
  const effectiveProductsPerPage = productsPerPage === 0 ? Math.max(visibleProducts.length, 1) : productsPerPage;
  const productPageCount = Math.max(1, Math.ceil(visibleProducts.length / effectiveProductsPerPage));
  const currentProductPage = Math.min(productPage, productPageCount);
  const productPageStart = (currentProductPage - 1) * effectiveProductsPerPage;
  const pagedProducts = visibleProducts.slice(productPageStart, productPageStart + effectiveProductsPerPage);
  const displayedProducts = isMobile ? visibleProducts : pagedProducts;
  const productEstimatorWidth = Number(productEstimatorForm.width) || 0;
  const productEstimatorHeight = Number(productEstimatorForm.height) || 0;
  const selectedEstimatorState = selectedProduct
    ? getProductEstimatorState(selectedProduct, productEstimatorForm)
    : null;
  const productEstimatorDimensionError = selectedEstimatorState?.dimensionError || "";
  const productEstimatorQuantityError = getProductEstimatorQuantityError(productEstimatorForm.quantity);
  const productEstimatorQuantity = productEstimatorQuantityError ? 0 : Number(productEstimatorForm.quantity);
  const selectedProductFrame = (selectedProduct?.blade_frame_types || []).find((frame) => frame.name === productEstimatorForm.frame_type);
  const productBladeMinimum = Math.max(1, Number(selectedProduct?.minimum_blades) || 1);
  const productBladeMaximum = Number(selectedProduct?.maximum_blades) || 0;
  const selectedFrameBladeCount = Number(selectedProductFrame?.blade_count) || 0;
  const bladeCountMinimum = productEstimatorForm.sale_mode === "frame" && !productEstimatorForm.custom_frame_size && selectedFrameBladeCount > 0
    ? selectedFrameBladeCount
    : productBladeMinimum;
  const effectiveBladeCount = Number(productEstimatorForm.blade_count) || bladeCountMinimum;
  const rawProductEstimatorResult = selectedProduct && !productEstimatorQuantityError && !productEstimatorDimensionError ? calculateEstimate({
    productName: selectedProduct.product_name || selectedProduct.name,
    categoryKey: selectedProduct.product_type || selectedProduct.category,
    variantName: selectedProduct.variant,
    width: productEstimatorWidth,
    height: productEstimatorHeight,
    measurementUnit: productEstimatorForm.unit,
    quantity: productEstimatorQuantity,
    blade_count: isBladeProduct(selectedProduct) ? effectiveBladeCount : selectedProduct.blade_count || 0,
    base_price: selectedProduct.base_price || undefined,
    overrideRate: getProductEstimateRate(selectedProduct, productEstimatorForm),
    customization: selectedProduct.customization || false,
    customization_fee: selectedProduct.customization_fee || 0,
  }) : null;
  const productEstimatorResult = selectedProduct
    ? isBladeProduct(selectedProduct)
      ? {
          estimated_price: productEstimatorQuantityError || productEstimatorDimensionError ? 0 : getProductLineTotal(selectedProduct, {
            ...productEstimatorForm,
            quantity: productEstimatorQuantity,
            blade_count: effectiveBladeCount,
          }),
          rate: getProductEstimateRate(selectedProduct),
          areaDisplay: `${effectiveBladeCount} blade${effectiveBladeCount === 1 ? "" : "s"}`,
        }
      : {
          ...rawProductEstimatorResult,
          estimated_price: productEstimatorQuantityError || productEstimatorDimensionError ? 0 : getProductLineTotal(selectedProduct, {
            width: productEstimatorWidth,
            height: productEstimatorHeight,
            measurement_unit: productEstimatorForm.unit,
            quantity: productEstimatorQuantity,
            customized: true,
            piece_option: productEstimatorForm.piece_option,
            piece_options: selectedProduct.piece_options || [],
            area_option: productEstimatorForm.area_option,
            area_options: selectedProduct.area_options || [],
          }),
        }
    : null;
  const selectedProductRating = selectedProduct
    ? featuredProductStats[selectedProduct._id || selectedProduct.id] || { averageRating: 0, ratingsCount: 0 }
    : { averageRating: 0, ratingsCount: 0 };
  const selectedProductDimensions = selectedProduct && !isBladeProduct(selectedProduct)
    ? getProductDimensionsLabel(selectedProduct) || "N/A"
    : "N/A";
  const isProductModalReadOnly = !customerPermissions.can_request_orders && !customerPermissions.can_estimate_pricing;
  const hasStructuredProductModal = !isProductModalReadOnly && (isBladeProduct(selectedProduct) || isAreaProduct(selectedProduct));
  const selectedProductDefaultDimensions = selectedProduct ? getProductDefaultDimensions(selectedProduct) : null;

  const continueProductActionAfterLogin = (
    actionType,
    productOverride = selectedProduct,
    configurationOverride = null,
  ) => {
    if (authLoading) {
      toast("Checking your account. Please try again in a moment.");
      return;
    }
    if (actionType === "estimate" && !customerPermissions.can_estimate_pricing) {
      toast.error("Price estimation is currently unavailable.");
      return;
    }
    if (actionType !== "estimate" && user && !customerPermissions.can_request_orders) {
      toast.error("Order requests are currently unavailable.");
      return;
    }
    if (!productOverride) return;
    const actionConfiguration = configurationOverride || productEstimatorForm;
    const estimatorValidation = getProductEstimatorState(productOverride, actionConfiguration);
    if (estimatorValidation.dimensionError || estimatorValidation.quantityError || estimatorValidation.bladeCountError) {
      setPendingActionError(
        estimatorValidation.dimensionError || estimatorValidation.quantityError || estimatorValidation.bladeCountError
      );
      return;
    }
    if (actionType === "estimate") {
      const quantityError = getProductEstimatorQuantityError(actionConfiguration?.quantity ?? 1);
      if (quantityError) {
        setPendingActionError(quantityError);
        return;
      }
      const dimensionError = getProductEstimatorState(productOverride, actionConfiguration).dimensionError;
      if (dimensionError) {
        setPendingActionError(dimensionError);
        return;
      }
    }
    const actionProduct = normalizeBrowseProduct(productOverride);
    const productId = String(actionProduct._id || actionProduct.id || "");
    if (!productId) {
      setPendingActionError("This product cannot be requested right now. Please refresh and try again.");
      return;
    }

    const defaultDimensions = getProductDefaultDimensions(actionProduct);
    const hasCustomWidth = Number(actionConfiguration.width) > 0;
    const hasCustomHeight = Number(actionConfiguration.height) > 0;
    const hasCustomDimensions = actionConfiguration.useProductDefaults === true
      ? false
      : hasCustomWidth || hasCustomHeight;
    const selection = {
      width: actionType === "direct" && !hasCustomWidth ? defaultDimensions.width : actionConfiguration.width,
      height: actionType === "direct" && !hasCustomHeight ? defaultDimensions.height : actionConfiguration.height,
      unit: actionType === "direct" && !hasCustomDimensions
        ? defaultDimensions.unit || actionConfiguration.unit || "in"
        : actionConfiguration.unit || defaultDimensions.unit || "in",
      quantity: Math.max(1, Number(actionConfiguration.quantity) || 1),
      notes: "",
      customized: actionType === "estimate" || hasCustomDimensions,
      variant: actionProduct.variant || actionProduct.color || "",
      blade_glass_type: actionConfiguration.blade_glass_type || "",
      piece_option: actionConfiguration.piece_option ?? "",
      area_option: actionConfiguration.area_option ?? "",
      sale_mode: actionConfiguration.sale_mode || "blades_only",
      frame_type: actionConfiguration.frame_type || "",
      custom_frame_size: Boolean(actionConfiguration.custom_frame_size),
      blade_count: actionConfiguration.blade_count,
      extra_charges: actionConfiguration.extra_charges?.length
        ? actionConfiguration.extra_charges
        : getDefaultExtraChargeSelections(actionProduct),
    };
    const savedAction = savePendingProductAction({
      actionType,
      productId,
      productSnapshot: {
        ...actionProduct,
        name: actionProduct.name || actionProduct.product_name || "Product",
        product_name: actionProduct.product_name || actionProduct.name || "Product",
        product_type: actionProduct.product_type || actionProduct.type || "",
        category: actionProduct.category || "",
        variant: selection.variant,
        image_url: getProductImage(actionProduct),
        pricing_method: actionProduct.pricing_method || actionProduct.unit || "",
      },
      pricingConfiguration: {
        pricing_method: actionProduct.pricing_method || actionProduct.unit || "",
        price_per_sqft: Number(actionProduct.price_per_sqft) || 0,
        price_per_blade: Number(actionProduct.price_per_blade) || 0,
        piece_options: actionProduct.piece_options || [],
        area_options: actionProduct.area_options || [],
        unit_price: Number(actionProduct.unit_price) || 0,
        base_price: Number(actionProduct.base_price) || 0,
      },
      selection,
      estimate: actionType === "estimate" ? {
        estimated_price: selectedProduct === actionProduct ? selectedEstimatorState?.result?.estimated_price || productEstimatorResult?.estimated_price || 0 : 0,
        estimated_area: selectedProduct === actionProduct ? selectedEstimatorState?.result?.estimated_area || 0 : 0,
        rate: selectedProduct === actionProduct ? selectedEstimatorState?.result?.rate || productEstimatorResult?.rate || 0 : 0,
        area_display: selectedProduct === actionProduct ? selectedEstimatorState?.result?.areaDisplay || productEstimatorResult?.areaDisplay || "" : "",
      } : null,
    });

    if (!savedAction) {
      setPendingActionError("We couldn't save your product details. Check browser storage and try again.");
      return;
    }

    setPendingActionError("");
    if (selectedProduct === actionProduct) setSelectedProduct(null);
    if (!user && actionType === "direct") {
      setPendingGuestCartAdd(null);
      setPendingGuestOrderActionId(savedAction.id);
      setLoginRequiredAction("order");
      setShowLoginRequired(true);
      return;
    }
    navigate("/login", {
      state: { from: { pathname: "/customer-dashboard", search: "?tab=products&resumeLandingProduct=1" } },
    });
  };

  const handleTrackOrder = async (event) => {
    event.preventDefault();
    if (!customerPermissions.can_track_products) {
      setTrackingError("Order tracking is currently unavailable.");
      setTrackingResult(null);
      setRepairTrackingResult(null);
      return;
    }
    const tracking = trackingNumber.trim();
    if (!tracking) {
      setTrackingError("Please enter your tracking number.");
      setTrackingResult(null);
      setRepairTrackingResult(null);
      return;
    }

    setTrackingLoading(true);
    setTrackingError("");
    setTrackingResult(null);
    setRepairTrackingResult(null);
    setShowAllTrackedItems(false);
    try {
      if (/^RPR-/i.test(tracking)) {
        const response = await trackRepairRequest(tracking);
        setRepairTrackingResult(response.repair);
        return;
      }
      const response = await trackOrder(tracking);
      setTrackingResult(response.order || response);
    } catch (error) {
      setTrackingError(error.data?.message || error.message || "No order found with that tracking number.");
    } finally {
      setTrackingLoading(false);
    }
  };

  const statusLabel = (status) => String(status || "Unknown").replace(/_/g, " ");

  const getStatusBadgeClass = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized.includes("complete") || normalized === "delivered") return "border-emerald-300 bg-emerald-50 text-emerald-800";
    if (normalized.includes("cancel") || normalized.includes("declin") || normalized.includes("reject")) return "border-rose-300 bg-rose-50 text-rose-800";
    if (normalized.includes("process") || normalized.includes("install")) return "border-sky-300 bg-sky-50 text-sky-800";
    return "border-amber-300 bg-amber-50 text-amber-900";
  };

  const getStatusBadgeIcon = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized.includes("complete") || normalized === "delivered") return CircleCheck;
    if (normalized.includes("cancel") || normalized.includes("declin") || normalized.includes("reject")) return CircleX;
    return CircleAlert;
  };

  const formatCurrency = (value) => {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDateText = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("en-PH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const getOrderCustomerName = (order) => {
    if (!order) return "—";
    if (order.customer_name) return order.customer_name;
    const customer = order.customer || {};
    return `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "—";
  };

  const getOrderShippingAddress = (order) => {
    if (!order) return "—";
    const shippingAddress = order.shipping_address || order.customer?.shipping_address;
    if (typeof shippingAddress === "string" && shippingAddress.trim()) return shippingAddress.trim();

    const shipping = shippingAddress && typeof shippingAddress === "object" ? shippingAddress : {};
    const addressParts = [
      shipping.street_address || shipping.street || shipping.address_line || shipping.line1,
      shipping.city,
      shipping.province || shipping.state,
      shipping.zip_code || shipping.postal_code,
    ].filter(Boolean);

    if (addressParts.length > 0) return addressParts.join(", ");
    const customer = order.customer || {};
    const customerAddress = [customer.street_address, customer.city, customer.province, customer.zip_code]
      .filter(Boolean)
      .join(", ");
    return customerAddress || "—";
  };

  const getTrackedItemAmount = (item) => {
    const savedLineTotal = Number(item?.line_total);
    if (savedLineTotal > 0) return savedLineTotal;

    const legacyTotal = Number(item?.total_amount || item?.amount);
    if (legacyTotal > 0) return legacyTotal;

    if (item?.is_estimate) {
      const estimatedTotal = Number(item.estimated_price || item.manual_estimated_total || 0);
      if (estimatedTotal > 0) return estimatedTotal;
    }

    const quantity = Math.max(1, Number(item?.quantity || item?.qty) || 1);
    const area = Number(item?.area || item?.dimensions?.area || 0);
    const pricePerSqft = Number(
      item?.price_per_sqft || item?.product_id?.price_per_sqft || item?.product?.price_per_sqft || 0
    );
    if (area > 0 && pricePerSqft > 0) return area * pricePerSqft;

    const unitPrice = Number(
      item?.unit_price || item?.product_id?.unit_price || item?.product?.unit_price || 0
    );
    return unitPrice * quantity;
  };

  const renderRatingStars = (rating = 0, size = 16) => {
    const normalizedRating = Number(rating) || 0;
    const fullStars = Math.floor(normalizedRating);
    const hasHalfStar = normalizedRating - fullStars >= 0.5;
    return Array.from({ length: 5 }, (_, index) => {
      if (index < fullStars) return <Star key={index} size={size} fill="#ffc21a" className="text-amber-500" />;
      if (index === fullStars && hasHalfStar) return <StarHalf key={index} size={size} fill="#ffc21a" className="text-amber-500" />;
      return <Star key={index} size={size} className="text-slate-300" />;
    });
  };

  const productEstimatorContent = selectedProduct && !isProductModalReadOnly && (customerPermissions.can_estimate_pricing || pendingActionError) ? <>
    {customerPermissions.can_estimate_pricing && <ProductPriceEstimator
      product={selectedProduct}
      form={productEstimatorForm}
      onFormChange={setProductEstimatorForm}
      formatCurrency={formatCurrency}
      bladeModalLayout={isBladeProduct(selectedProduct)}
      defaultMeasurements={isAreaProduct(selectedProduct) && selectedProductDefaultDimensions?.width > 0 && selectedProductDefaultDimensions?.height > 0 ? selectedProductDefaultDimensions : null}
      footer={customerPermissions.can_request_orders && <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => continueProductActionAfterLogin("direct")}
          disabled={Boolean(productEstimatorDimensionError || productEstimatorQuantityError || selectedEstimatorState?.bladeCountError)}
          className={`inline-flex w-full items-center justify-center gap-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${isBladeProduct(selectedProduct) ? "h-[46px] rounded-[10px] bg-red-600 text-white hover:bg-red-700" : "min-h-12 rounded-xl bg-red-600 px-4 py-3 text-white hover:bg-red-700"}`}
        >
          <Package size={17} aria-hidden="true" /> Place Order
        </button>
        <button
          type="button"
          onClick={() => handleAddToCart(selectedProduct, productEstimatorForm)}
          disabled={addingCartProductId === String(selectedProduct._id || selectedProduct.id || "") || Boolean(productEstimatorDimensionError || productEstimatorQuantityError || selectedEstimatorState?.bladeCountError)}
          className={`inline-flex w-full items-center justify-center gap-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50 ${isBladeProduct(selectedProduct) ? "h-[46px] rounded-[10px] border border-slate-200 bg-white text-slate-900 hover:bg-slate-50" : "min-h-12 rounded-xl bg-slate-950 px-4 py-3 text-white hover:bg-slate-800"}`}
        >
          {addingCartProductId === String(selectedProduct._id || selectedProduct.id || "")
            ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
            : <ShoppingCart size={17} aria-hidden="true" />}
          Add to Cart
        </button>
      </div>}
    />}
    {pendingActionError && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{pendingActionError}</p>}
  </> : null;

  return (
  <div className="landing-page-shell flex min-h-screen flex-col overflow-x-hidden bg-white text-gray-900">
      <AppToaster />

      {/* NAVBAR */}

      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/50 bg-white/90 shadow-sm backdrop-blur-2xl">

        <div className="flex w-full items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">

          {/* LOGO */}

          <button
            type="button"
            onClick={() => scrollToSection("home")}
            className="mx-auto flex min-w-0 items-center gap-2 px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:gap-3 sm:px-1.5 lg:mx-0"
            aria-label="Go to ACGC Services home"
          >
            <img
              src={logo}
              alt="logo"
              className="h-10 w-10 shrink-0 object-contain sm:h-12 sm:w-12 lg:h-14 lg:w-14"
            />

            <div className="min-w-0 leading-tight">
              <h1 className="whitespace-nowrap text-[15px] font-semibold text-red-600 sm:text-xl">
                ACGC Services
              </h1>
              <p className="whitespace-nowrap text-[10px] font-medium text-gray-600 sm:text-sm">
                Aluminum & Glass Services
              </p>
            </div>
          </button>

          <div className="hidden flex-wrap items-center gap-1.5 lg:flex md:gap-2">
            <nav className="flex flex-wrap items-center gap-1.5 md:gap-2">
              {[
            { name: "Browse Products", id: "products" },
            { name: "About Us", id: "about" },
            { name: "Track Order", id: "track-order" },
              ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => scrollToSection(item.id)}
              aria-current={active === item.id ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-base font-medium transition-colors motion-reduce:transition-none ${
                active === item.id
                    ? "border border-slate-200 bg-slate-100 text-red-600 shadow-sm"
                    : "text-slate-700 hover:bg-slate-100"
                  } focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2`}
            >
              {item.name}
            </button>
              ))}
            </nav>

            <Link
              to="/login"
              className="rounded-full px-4 py-2 text-base font-medium text-gray-700 transition-colors hover:bg-slate-100 motion-reduce:transition-none"
            >
              Login
            </Link>

            <Link
              to="/signup"
              className="rounded-full bg-red-600 px-4 py-2 text-base font-medium text-white transition-opacity hover:opacity-90 motion-reduce:transition-none"
            >
              Sign Up
            </Link>

          </div>

        </div>

        <div className="border-t border-slate-100/80 px-2 pb-2 pt-1.5 lg:hidden">
          <nav aria-label="Mobile navigation" className="mx-auto grid max-w-md grid-cols-3 gap-1">
            {[
              { name: "Products", id: "products" },
              { name: "About", id: "about" },
              { name: "Track Order", id: "track-order" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                aria-current={active === item.id ? "page" : undefined}
                className={`min-h-8 rounded-lg px-1 text-[11px] font-semibold transition-colors motion-reduce:transition-none ${active === item.id ? "border border-slate-200 bg-slate-100 text-red-600 shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500`}
              >
                {item.name}
              </button>
            ))}
          </nav>
          <div className="mx-auto mt-1.5 grid max-w-md grid-cols-2 gap-2">
            <Link
              to="/login"
              className="inline-flex min-h-8 items-center justify-center rounded-lg border border-red-700 px-3 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="inline-flex min-h-8 items-center justify-center rounded-lg bg-red-700 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Sign Up
            </Link>
          </div>
        </div>

      </header>

      {/* HERO */}

      {active === "home" && (
        <>
          <section id="home" className="relative scroll-mt-28 overflow-hidden bg-[#170d11] pt-32 text-white sm:scroll-mt-24 sm:pt-24">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.16),transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(239,68,68,0.2),transparent_28%),linear-gradient(135deg,#170d11_0%,#4b1017_38%,#140d13_100%)]" />
            <div className="absolute -left-16 top-28 h-72 w-72 rounded-full border border-white/10" />
            <div className="absolute -right-10 bottom-6 h-80 w-80 rounded-full border border-white/10" />
            <div className="absolute left-1/2 top-1/2 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />

            <div className="relative mx-auto max-w-7xl px-6 py-14 sm:py-20">
              <div className="mx-auto max-w-6xl rounded-[32px] border border-white/20 bg-white/[0.08] px-5 py-8 shadow-[0_25px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:px-8 sm:py-12 lg:px-10">
                <div className="mx-auto max-w-4xl text-center">
                  <p className="text-[11px] font-black uppercase tracking-[0.42em] text-red-100/90 sm:text-xs">ACGC Services</p>
                  <h1 className="mt-5 text-4xl font-black leading-[0.96] tracking-[-0.06em] sm:text-6xl lg:text-[5rem]">
                    Custom Glass &amp;
                    <span className="mt-2 block text-red-100/95">Aluminum Solutions</span>
                  </h1>
                  <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-red-50/90 sm:text-lg">
                    Professional fabrication and installation of glass windows, doors, partitions, and aluminum works designed for timeless architecture and practical performance.
                  </p>
                  <div className="mt-9 flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => scrollToSection("products")}
                      className="inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/20 px-6 py-3.5 text-sm font-black uppercase tracking-[0.08em] text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/30"
                    >
                      <ShoppingBag size={18} aria-hidden="true" /> Browse Products <ArrowRight size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollToSection("track-order")}
                      className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/5 px-6 py-3.5 text-sm font-black uppercase tracking-[0.08em] text-white transition hover:bg-white/10"
                    >
                      <Search size={18} aria-hidden="true" /> Track an Order
                    </button>
                  </div>
                </div>

                <div className="mt-10 grid gap-4 sm:grid-cols-3">
                  {[
                    { icon: ShieldCheck, title: "Quality Guaranteed", text: "Premium materials and careful workmanship." },
                    { icon: Clock3, title: "Fast Turnaround", text: "Efficient production for your project timeline." },
                    { icon: Wrench, title: "Expert Installation", text: "Professional site inspection and installation." },
                  ].map(({ icon: Icon, title, text }) => (
                    <div key={title} className="rounded-[24px] border border-white/20 bg-white/[0.08] p-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-2xl transition hover:-translate-y-1 hover:bg-white/[0.14] sm:p-5">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-white/[0.12] text-red-100 backdrop-blur-xl">
                        <Icon className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
                      </div>
                      <h2 className="mt-4 text-xl font-black text-white">{title}</h2>
                      <p className="mt-2 text-sm leading-6 text-red-50/80">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {showHeroScrollArrow && (
              <button
                type="button"
                onClick={() => document.getElementById("featured-products")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" })}
                aria-label="Scroll down to discover products"
                title="Scroll down to discover products"
                className="absolute bottom-3 left-1/2 z-10 inline-flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border-2 border-red-100 bg-white text-red-700 shadow-[0_8px_24px_rgba(220,38,38,0.24)] ring-4 ring-red-400/20 transition duration-200 hover:-translate-y-1 hover:scale-105 hover:bg-red-50 hover:text-red-800 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#341017] motion-reduce:transition-none"
              >
                <ChevronDown size={30} strokeWidth={3} aria-hidden="true" className={reduceMotion ? "" : "animate-bounce"} />
              </button>
            )}
          </section>
        </>
      )}
      {/* PRODUCTS SECTION */}

      {active === "home" && (
        <section id="featured-products" className="relative mx-auto max-w-7xl scroll-mt-24 px-6 py-8">
          <div className="rounded-[30px] border border-white/65 bg-white/[0.3] p-5 shadow-[0_22px_50px_rgba(15,23,42,0.12)] backdrop-blur-2xl sm:p-7">
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: reduceMotion ? 0 : 0.72, ease: [0.22, 1, 0.36, 1] }}
              className="mb-6"
            >
              <p className="text-sm font-black uppercase tracking-[0.24em] text-red-600">Curated collection</p>
              <h2 className="mt-3 text-3xl font-black leading-tight sm:text-5xl sm:leading-none">
                Featured <span className="text-[#dc2626]">Products</span>
              </h2>
              <p className="mt-5 max-w-3xl text-sm leading-6 text-slate-600 sm:text-lg">
                Discover premium aluminum and glass solutions crafted for modern residential and commercial projects.
              </p>
            </motion.div>

            {featuredError ? (
              <div className="rounded-2xl border border-red-200/70 bg-white/40 p-4 text-sm text-red-700 backdrop-blur-xl">
                {featuredError}
              </div>
            ) : isLoadingFeatured ? (
              <div className="grid gap-5 md:grid-cols-3">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="h-72 animate-pulse rounded-[26px] border border-white/50 bg-white/35 backdrop-blur-xl" />
                ))}
              </div>
            ) : featuredProducts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/65 bg-white/35 p-8 text-center text-slate-600 backdrop-blur-xl">
                No products are available right now.
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-3">
                {featuredProducts.map((product, index) => {
                  const imageUrl = getProductImage(product, 480);
                  const reviewStats = featuredProductStats[product._id || product.id] || { averageRating: 0, ratingsCount: 0 };
                  const averageRating = Number(reviewStats.averageRating) || 0;
                  const reviewsCount = Number(reviewStats.ratingsCount) || 0;

                  return (
                    <motion.article
                      key={product._id || product.id || index}
                      role="button"
                      tabIndex={0}
                      aria-label={`View details for ${product.product_name || product.name || "featured product"}`}
                      onClick={() => handleFeaturedProductClick(product)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleFeaturedProductClick(product);
                        }
                      }}
                      initial={reduceMotion ? false : { opacity: 0, y: 22 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, amount: 0.12 }}
                      transition={{ delay: reduceMotion ? 0 : index * 0.055, duration: reduceMotion ? 0 : 0.68, ease: [0.22, 1, 0.36, 1] }}
                      whileHover={reduceMotion ? undefined : { y: -3, transition: { duration: 0.2, ease: "easeOut" } }}
                      className="group flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-[26px] border border-white/65 bg-white/[0.2] shadow-[0_18px_38px_rgba(15,23,42,0.08)] backdrop-blur-xl transition hover:shadow-[0_24px_48px_rgba(127,29,29,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100/70">
                        <div data-product-image-skeleton className="absolute inset-0 animate-pulse bg-slate-200 motion-reduce:animate-none" />
                        <img
                          src={imageUrl || PRODUCT_IMAGE_PLACEHOLDER}
                          srcSet={getProductImageSrcSet(imageUrl, [320, 480, 640])}
                          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 33vw, 400px"
                          alt={product.product_name || product.name || "Featured product"}
                          width="640"
                          height="480"
                          loading={index === 0 ? "eager" : "lazy"}
                          fetchPriority={index === 0 ? "high" : "low"}
                          decoding="async"
                          onLoad={handleProductImageLoad}
                          onError={handleProductImageError}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-900/10 to-transparent" />
                        <h3 className="absolute inset-x-4 bottom-4 line-clamp-2 text-lg font-black leading-tight text-white drop-shadow-[0_2px_5px_rgba(0,0,0,0.9)] sm:text-xl">
                          {product.product_name || product.name || "Product"}
                        </h3>
                        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-100/95 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-950 shadow-lg backdrop-blur-sm">
                          <Star size={12} fill="currentColor" aria-hidden="true" />
                          Featured
                        </span>
                      </div>

                      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
                        <p className="line-clamp-3 min-h-[4.5rem] text-sm leading-6 text-slate-700">
                          {product.description || "Premium aluminum and glass solution for modern spaces."}
                        </p>
                        {canSeeCustomerRatings && (
                          <div className="flex items-center gap-2">
                            <div className="flex shrink-0 items-center gap-0.5 text-amber-500">
                              {renderRatingStars(averageRating, 14)}
                            </div>
                            <span className="text-xs font-semibold text-slate-600">
                              {averageRating > 0 ? `${averageRating.toFixed(1)} (${reviewsCount})` : "New"}
                            </span>
                          </div>
                        )}
                        <div className="mt-auto border-t border-white/60 pt-3">
                          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Starting from</p>
                          <p className="mt-1 text-2xl font-black text-red-700">{getProductPrice(product)}</p>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            )}
          </div>

          {canSeeCustomerRatings && <>
            <LandingScrollCue reduceMotion={reduceMotion} targetId="customer-ratings" label="Scroll down to customer ratings" />
            <section id="customer-ratings" className="mt-8 rounded-[30px] border border-white/60 bg-white/[0.32] px-6 py-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)] backdrop-blur-2xl sm:px-10">
            <h2 className="text-center text-3xl font-black text-slate-900">Customer Ratings</h2>
            <div className="mt-8 grid gap-8 md:grid-cols-[220px_1fr] md:items-center">
              <div className="text-center">
                <p className="text-6xl font-black leading-none text-slate-950">{featuredRatingStats.average.toFixed(1)}</p>
                <div className="mt-3 flex justify-center gap-1 text-amber-500">
                  {renderRatingStars(featuredRatingStats.average, 22)}
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-600">
                  Average Rating ({featuredRatingStats.total} review{featuredRatingStats.total === 1 ? "" : "s"})
                </p>
              </div>
              <div className="space-y-3">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = featuredRatingStats.counts[star] || 0;
                  const percentage = featuredRatingStats.total
                    ? Math.round((count / featuredRatingStats.total) * 100)
                    : 0;
                  return (
                    <div key={star} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-sm">
                      <span className="font-semibold text-slate-600">{star}</span>
                      <div className="h-3 overflow-hidden rounded-full bg-white/55">
                        <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${percentage}%` }} />
                      </div>
                      <span className="w-12 text-right font-semibold text-slate-500">{percentage}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
          </>}
        </section>
      )}

{active === "products" && (
  <section id="products" className="mx-auto w-full min-w-0 max-w-7xl scroll-mt-28 px-3 pb-10 pt-32 sm:px-6 sm:py-14 sm:scroll-mt-24">
    <div className="mb-6 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.25em] text-red-600">ACGC Catalog</p>
        <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Browse Products</h2>
        <p className="mt-2 text-sm text-slate-600">Browse available aluminum &amp; glass products.</p>
      </div>
      <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)_minmax(9rem,12rem)] md:max-w-4xl md:justify-end">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search products</span>
          <Search size={18} className="absolute left-3 top-3.5 text-slate-400" aria-hidden="true" />
          <input
            value={productSearch}
            onChange={(event) => {
              setProductSearch(event.target.value);
              setProductPage(1);
            }}
            placeholder="Search products..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-slate-900 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
          />
        </label>
        <FilterDropdown
          label="All types"
          value={productType}
          onChange={(value) => { setProductType(value); setProductPage(1); }}
          options={[["All", "All types"], ...productTypeOptions.map((type) => [type, type])]}
        />
        <FilterDropdown
          label="All categories"
          value={productCategory}
          onChange={(value) => { setProductCategory(value); setProductPage(1); }}
          options={[["All", "All categories"], ...productCategoryOptions.map((category) => [category, category.charAt(0).toUpperCase() + category.slice(1)])]}
        />
      </div>
    </div>

    {isLoadingFeatured ? (
      <div className="mx-auto grid w-full min-w-0 max-w-[1200px] grid-cols-1 gap-3 min-[768px]:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] min-[768px]:gap-5">
        {[...Array(8)].map((_, index) => (
          <div key={index} className="min-h-[184px] animate-pulse rounded-[18px] border border-slate-200 bg-white min-[768px]:min-h-[410px]" />
        ))}
      </div>
    ) : featuredError ? (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{featuredError}</div>
    ) : visibleProducts.length === 0 ? (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-10 text-center text-slate-600 backdrop-blur-xl">
        No products matched your search.
      </div>
    ) : (
      <>
        <div className="mx-auto grid w-full min-w-0 max-w-[1200px] grid-cols-1 gap-3 min-[768px]:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] min-[768px]:gap-5">
          {displayedProducts.map((product, index) => {
            const productId = product._id || product.id || `${product.name}-${index}`;
            const rating = featuredProductStats[product._id || product.id] || { averageRating: 0, ratingsCount: 0 };
            const image = getProductImage(product);
            const productName = product.product_name || product.name || "Unnamed Product";
            const category = product.product_type || product.category || "General";
            const productDimensions = getProductDefaultDimensions(product);

            return (
              <article
                key={productId}
                role="button"
                tabIndex={0}
                aria-label={`View details for ${productName}`}
                onClick={() => openProductDetails(product)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openProductDetails(product);
                  }
                }}
                className="landing-product-card group relative flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-[18px] border border-[var(--product-border)] bg-[var(--product-card)] shadow-[0_4px_14px_rgba(30,24,16,0.08)] transition-[transform,box-shadow,border-color] duration-[180ms] ease-out hover:-translate-y-1 hover:border-red-300 hover:shadow-[0_16px_36px_rgba(30,24,16,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 motion-reduce:transition-none"
              >
                <div className="product-card-image group/image relative aspect-[4/3] overflow-hidden bg-slate-100">
                  <div data-product-image-skeleton className="absolute inset-0 animate-pulse bg-slate-200 motion-reduce:animate-none" />
                  <img
                    src={image || PRODUCT_IMAGE_PLACEHOLDER}
                    srcSet={getProductImageSrcSet(image)}
                    sizes={isMobile ? "30vw" : "(max-width: 1280px) 33vw, 25vw"}
                    alt={productName}
                    width="640"
                    height="480"
                    loading={index < (isMobile ? 2 : 4) ? "eager" : "lazy"}
                    fetchPriority={index === 0 ? "high" : "auto"}
                    decoding="async"
                    onLoad={handleProductImageLoad}
                    onError={handleProductImageError}
                    className="h-full w-full object-cover transition-transform duration-[350ms] ease-out group-hover/image:scale-105 motion-reduce:transition-none"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-black/30 to-transparent" />
                  <div className="product-card-badges absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
                    {product.is_featured ? (
                      <>
                        <span aria-label="Top Product" title="Top Product" className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--product-gold)] px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[0.07em] text-[var(--product-gold-text)]">
                          <Star className="size-[11px] shrink-0" fill="currentColor" aria-hidden="true" /> Top Product
                        </span>
                        <span title={product.category || "General"} className="inline-flex min-w-0 max-w-[55%] truncate whitespace-nowrap rounded-full bg-[rgba(30,26,22,0.72)] px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[0.07em] text-white backdrop-blur-sm">
                          {product.category || "General"}
                        </span>
                      </>
                    ) : (
                      <span className="inline-flex max-w-[70%] truncate whitespace-nowrap rounded-full bg-[rgba(30,26,22,0.72)] px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[0.07em] text-white backdrop-blur-sm">
                        {product.category || "General"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="product-card-details flex min-w-0 flex-1 flex-col p-4">
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-[16.5px] font-extrabold leading-tight text-[var(--product-text)]" title={productName}>{productName}</h3>
                    <p className="mt-1 truncate text-[12.5px] font-medium text-[var(--product-muted)]">{category}</p>
                  </div>

                  {canSeeCustomerRatings && (
                    <div className="customer-product-rating mt-[10px] flex min-w-0 items-center gap-1.5">
                      <span className="flex shrink-0 items-center gap-[1px] tracking-[1px]">{renderRatingStars(rating.averageRating || 0, 14)}</span>
                      <span className="truncate text-xs font-semibold text-[var(--product-muted)]">
                        {rating.ratingsCount ? `${rating.averageRating.toFixed(1)} · ${rating.ratingsCount} reviews` : "No ratings yet"}
                      </span>
                    </div>
                  )}

                  {String(product.pricing_method || product.unit).toLowerCase() === "blade" && product.sell_with_frame && product.blade_frame_types?.length > 0 && (
                    <p className="product-card-metrics mt-2 flex min-h-[62px] flex-wrap content-center items-baseline gap-x-1 text-sm leading-5 text-[var(--product-text)]" title={`With frame: ${product.blade_frame_types.map((frame) => frame.name).join(" / ")}`}>
                      <span className="font-semibold text-[var(--product-muted)]">With frame:</span>
                      <span className="font-bold">{product.blade_frame_types.map((frame) => frame.name).join(" / ")}</span>
                    </p>
                  )}

                  {String(product.pricing_method || product.unit).toLowerCase() !== "blade" && (
                    <div className="product-card-metrics mt-2 flex min-h-[62px] flex-col justify-center divide-y divide-dashed divide-[var(--product-border)] text-sm">
                      {!isBladeProduct(product) && (productDimensions.width > 0 || productDimensions.height > 0) && (
                        <p className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                          <span className="shrink-0 font-medium text-[var(--product-muted)]">Width × Height</span>
                          <span className="truncate text-right font-bold text-[var(--product-text)]">
                            {productDimensions.width || "N/A"} × {productDimensions.height || "N/A"}
                          </span>
                        </p>
                      )}
                      <p className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                        <span className="font-medium text-[var(--product-muted)]">Unit rate</span>
                        <span className="font-bold text-[var(--product-text)]">{getProductUnitRate(product)}</span>
                      </p>
                    </div>
                  )}

                  <div className="product-card-footer mt-auto flex items-end justify-between gap-3 border-t border-[var(--product-border)] pt-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.1em] text-[var(--product-muted)]">Starting from</p>
                      <p className="mt-1 truncate text-[22px] font-extrabold leading-tight text-[var(--product-price)]">{getProductPrice(product)}</p>
                    </div>
                    {customerPermissions.can_request_orders && <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          continueProductActionAfterLogin("direct", product, getDefaultCartOptions(product));
                        }}
                        className="inline-flex size-[38px] items-center justify-center rounded-full border border-[var(--product-border)] bg-[var(--product-card)] text-[var(--product-text)] transition-colors duration-150 hover:border-red-600 hover:bg-red-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        aria-label={`Place order for ${productName}`}
                        title="Place order"
                      >
                        <Package size={17} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleAddToCart(product);
                        }}
                        disabled={addingCartProductId === String(productId)}
                        className="inline-flex size-[38px] items-center justify-center rounded-full border border-red-600 bg-red-600 text-white transition-colors duration-150 hover:border-red-700 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Add to cart"
                        title="Add to cart"
                      >
                        {addingCartProductId === String(productId)
                          ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
                          : <ShoppingCart size={17} aria-hidden="true" />}
                      </button>
                    </div>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {!isMobile && visibleProducts.length > 0 && (
          <div className="mt-6 grid gap-4 rounded-[20px] border border-red-100 bg-white/90 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl md:grid-cols-[1fr_auto_1fr] md:items-center">
            <div className="flex min-w-0 items-center gap-3 text-sm font-medium text-slate-600">
              <span className="shrink-0 whitespace-nowrap">Items per page</span>
              <CustomerDropdown
                ariaLabel="Items per page"
                value={productsPerPage === 0 ? "all" : productsPerPage}
                onChange={(event) => {
                  setProductsPerPage(event.target.value === "all" ? 0 : Number(event.target.value));
                  setProductPage(1);
                }}
                className="h-11 !w-36 min-w-0 shrink-0 rounded-xl px-3"
              >
                <option value={4}>4</option>
                <option value={8}>8</option>
                <option value={12}>12</option>
                <option value={16}>16</option>
                <option value="all">All products</option>
              </CustomerDropdown>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                disabled={currentProductPage === 1}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                Previous
              </button>
              <div className="flex flex-wrap items-center justify-center gap-1">
                {Array.from({ length: Math.max(1, productPageCount) }, (_, index) => index + 1).map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => setProductPage(pageNumber)}
                    aria-current={pageNumber === currentProductPage ? "page" : undefined}
                    className={`h-9 min-w-9 rounded-xl px-2 text-sm font-bold transition ${
                      pageNumber === currentProductPage
                        ? "bg-red-600 text-white shadow-sm"
                        : "border border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:text-red-600"
                    }`}
                  >
                    {pageNumber}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setProductPage((page) => Math.min(productPageCount, page + 1))}
                disabled={currentProductPage === productPageCount}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                Next
              </button>
            </div>
            <div className="text-center text-sm font-medium text-slate-600 md:text-right">
              Showing {productPageStart + 1}-{Math.min(productPageStart + effectiveProductsPerPage, visibleProducts.length)} of {visibleProducts.length} products
            </div>
          </div>
        )}
      </>
    )}
  </section>
)}

{selectedProduct && createPortal((
  <div
    className={`customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-[100] flex min-h-dvh items-center justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm sm:p-5 ${hasStructuredProductModal ? "max-[759px]:!items-stretch max-[759px]:!justify-start max-[759px]:!p-0" : ""}`}
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="landing-product-dialog-title"
      style={hasStructuredProductModal ? { maxWidth: "1000px" } : undefined}
      className={`mobile-fullscreen-dialog relative flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl ${hasStructuredProductModal ? "max-h-[92vh] max-w-[1000px] max-[759px]:!h-dvh max-[759px]:!max-h-dvh max-[759px]:!max-w-none max-[759px]:!rounded-none" : "max-h-[88vh] max-w-5xl"}`}
      onClick={(event) => event.stopPropagation()}
    >
      {!isProductModalReadOnly ? <header className="flex shrink-0 flex-col border-b border-red-500/30 bg-gradient-to-r from-red-700 via-red-600 to-red-600 px-4 py-2.5 text-white shadow-[0_8px_18px_rgba(220,38,38,0.16)] sm:px-5 sm:py-3">
        <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Package size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-red-100">Product details</p>
            <h2 id="landing-product-dialog-title" className="truncate text-base font-bold leading-tight sm:text-lg">
              {selectedProduct.product_name || selectedProduct.name || "Product"}
            </h2>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSelectedProduct(null)}
          aria-label="Close product details"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:h-9 sm:w-9"
        >
          <X size={20} aria-hidden="true" />
        </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white">{selectedProduct.category || selectedProduct.product_type || "General"}</span>
          <span className="flex items-center gap-1.5 text-xs font-medium text-red-50"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />Ready for inquiry</span>
        </div>
      </header> : <button
        type="button"
        onClick={() => setSelectedProduct(null)}
        aria-label="Close product details"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-md transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        <X size={18} aria-hidden="true" />
      </button>}

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={`grid items-start gap-4 p-[18px] sm:p-5 ${hasStructuredProductModal ? isAreaProduct(selectedProduct) ? "md:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.9fr)]" : "min-[560px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.9fr)] lg:gap-7 lg:p-6"}`}>
        <div className="min-w-0 space-y-4">
          <div
            style={hasStructuredProductModal && isBladeProduct(selectedProduct) ? { height: "clamp(200px, 28vh, 320px)", maxHeight: "320px" } : undefined}
            className={`relative w-full overflow-hidden rounded-2xl bg-white shadow-sm ${hasStructuredProductModal ? `rounded-[14px] border border-slate-200 ${isAreaProduct(selectedProduct) ? "aspect-[3/2]" : "min-h-[200px]"}` : "aspect-[3/2]"}`}
          >
            <div data-product-image-skeleton className="absolute inset-0 animate-pulse bg-slate-200 motion-reduce:animate-none" />
            <img
              src={getProductImage(selectedProduct, 960) || PRODUCT_IMAGE_PLACEHOLDER}
              srcSet={getProductImageSrcSet(getProductImage(selectedProduct, 960))}
              sizes="(max-width: 768px) 100vw, 50vw"
              alt={selectedProduct.product_name || selectedProduct.name || "Product"}
              width="960"
              height="720"
              loading="eager"
              decoding="async"
              onLoad={handleProductImageLoad}
              onError={handleProductImageError}
              className={`h-full w-full ${hasStructuredProductModal ? "object-cover" : "object-fill"}`}
            />
          </div>
          {hasStructuredProductModal && isAreaProduct(selectedProduct) && <>
            <div className="rounded-[16px] border border-slate-200 bg-[#eef0ee] p-5">
              <h3 className="text-base font-bold text-slate-900">Product Details</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{selectedProduct.description || "No description available."}</p>
            </div>

          </>}
          {!hasStructuredProductModal && !isProductModalReadOnly && <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-base font-bold text-slate-900">Product Details</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">
                {selectedProduct.description || "No description available."}
              </p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Starting from</p>
              <p className="mt-1 text-2xl font-black text-red-700">{getProductPrice(selectedProduct)}</p>
              <p className="mt-1 text-xs text-slate-500">Price may vary based on specifications.</p>
            </div>
          </div>}

          {(!isBladeProduct(selectedProduct) || isProductModalReadOnly) && <ProductSpecifications product={selectedProduct} className="mt-4" />}
        </div>

        <aside className="min-w-0 space-y-3">
          {hasStructuredProductModal ? <div className="grid content-start gap-3">
            <div className="min-w-0 rounded-[14px] border border-red-200 bg-red-50 px-5 py-4">
              <p className={`text-[10.5px] font-bold uppercase ${isAreaProduct(selectedProduct) ? "tracking-[0.12em] text-slate-500" : "tracking-[0.08em] text-red-700"}`}>Starting from</p>
              <p className={`mt-0.5 font-extrabold leading-tight text-red-700 ${isAreaProduct(selectedProduct) ? "text-[30px]" : "text-[28px]"}`}>{getProductPrice(selectedProduct)}</p>
              <p className="mt-0.5 text-xs text-slate-500">Price may vary based on specifications</p>
            </div>
            {isBladeProduct(selectedProduct) && <ProductSpecifications product={selectedProduct} compact />}
            {isAreaProduct(selectedProduct) && productEstimatorContent && <div className="min-w-0">{productEstimatorContent}</div>}
          </div> : isProductModalReadOnly ? <>
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-full bg-red-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-red-700">
              {selectedProduct.product_type || selectedProduct.type || "Glass & Aluminum"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
              {selectedProduct.category || "General"}
            </span>
          </div>
          <h3 className="text-2xl font-black leading-tight text-slate-900">
            {selectedProduct.product_name || selectedProduct.name || "Product"}
          </h3>
          <p className="text-xl font-black text-slate-900">{getProductUnitRate(selectedProduct)}</p>
          <div className="border-t border-slate-200 pt-4">
            {selectedProductDimensions && <p className="text-sm font-medium text-slate-600">{selectedProductDimensions}</p>}
            <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-600">
              {selectedProduct.description || "No description available."}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 border-y border-slate-200 py-4 text-xs text-slate-500">
            <span>Contact ACGC for product inquiries.</span>
          </div>
          </> : <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-red-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-red-700">
              {selectedProduct.product_type || selectedProduct.type || "Glass & Aluminum"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
              {selectedProduct.category || "General"}
            </span>
          </div>
          <h3 className="text-2xl font-black leading-tight text-slate-900">
            {selectedProduct.product_name || selectedProduct.name || "Product"}
          </h3>
          {false && <section className="overflow-hidden rounded-xl border border-slate-200 border-t-2 border-t-red-600 bg-white p-4" aria-labelledby="landing-product-estimator-title">
            <div className="flex items-center gap-2">
              <Ruler size={16} className="text-red-600" aria-hidden="true" />
              <h4 id="landing-product-estimator-title" className="text-sm font-bold text-slate-900">Price Estimator</h4>
            </div>
            {isBladeProduct(selectedProduct) && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Array.isArray(selectedProduct.blade_glass_types) && selectedProduct.blade_glass_types.length > 0 && (
                  <label className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Glass type</span>
                    <CustomerDropdown
                      value={productEstimatorForm.blade_glass_type}
                      onChange={(event) => setProductEstimatorForm((current) => ({ ...current, blade_glass_type: event.target.value }))}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                    >
                      {selectedProduct.blade_glass_types.map((glass) => (
                        <option key={glass.name} value={glass.name}>{glass.name} — <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(glass.price_per_blade)}</span> / blade</option>
                      ))}
                    </CustomerDropdown>
                  </label>
                )}
                {selectedProduct.sell_with_frame && selectedProduct.sell_blades_only !== false && (
                  <label className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Sold as</span>
                    <CustomerDropdown
                      value={productEstimatorForm.custom_frame_size ? "custom_frame" : productEstimatorForm.sale_mode === "frame" ? `frame:${productEstimatorForm.frame_type}` : "blades_only"}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "blades_only") {
                          const bladeCount = Number(selectedProduct.minimum_blades) || Number(selectedProduct.blade_count) || 1;
                          setProductEstimatorForm((current) => ({ ...current, sale_mode: value, frame_type: "", custom_frame_size: false, blade_count: selectedProduct.customer_can_choose_blade_count ? "" : bladeCount }));
                        } else if (value === "custom_frame") {
                          const bladeCount = Number(selectedProduct.minimum_blades) || 1;
                          setProductEstimatorForm((current) => ({ ...current, sale_mode: "frame", frame_type: "", custom_frame_size: true, blade_count: selectedProduct.customer_can_choose_blade_count ? "" : bladeCount }));
                        } else {
                          const frame = selectedProduct.blade_frame_types.find((item) => `frame:${item.name}` === value);
                          const bladeCount = Number(frame?.blade_count) || Number(selectedProduct.minimum_blades) || 1;
                          setProductEstimatorForm((current) => ({ ...current, sale_mode: "frame", frame_type: frame?.name || "", custom_frame_size: false, blade_count: selectedProduct.customer_can_choose_blade_count ? "" : bladeCount }));
                        }
                      }}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                    >
                      <option value="blades_only">Blades only</option>
                      {(selectedProduct.blade_frame_types || []).map((frame) => (
                        <option key={frame.name} value={`frame:${frame.name}`}>{frame.name} — {Number(frame.blade_count) || 0} blades + <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(frame.price)}</span></option>
                      ))}
                      {selectedProduct.allow_custom_frame_size && <option value="custom_frame">Custom frame — <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(selectedProduct.custom_frame_price)}</span></option>}
                    </CustomerDropdown>
                  </label>
                )}
                {productEstimatorForm.sale_mode === "frame" && !productEstimatorForm.custom_frame_size && (selectedProduct.blade_frame_types || []).length > 0 && (
                  <label className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Frame type</span>
                    <CustomerDropdown
                      value={productEstimatorForm.frame_type}
                      onChange={(event) => {
                        const frame = selectedProduct.blade_frame_types.find((item) => item.name === event.target.value);
                        const bladeCount = Number(frame?.blade_count) || Number(selectedProduct.minimum_blades) || 1;
                        setProductEstimatorForm((current) => ({ ...current, frame_type: event.target.value, blade_count: selectedProduct.customer_can_choose_blade_count ? "" : bladeCount }));
                      }}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                    >
                      {selectedProduct.blade_frame_types.map((frame) => <option key={frame.name} value={frame.name}>{frame.name} — {Number(frame.blade_count) || 0} blades</option>)}
                    </CustomerDropdown>
                  </label>
                )}
                <label className="min-w-0">
                  <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Blade count</span>
                  {selectedProduct.customer_can_choose_blade_count ? (
                    <>
                      <input
                        type="number"
                        min={bladeCountMinimum}
                        max={productBladeMaximum || undefined}
                        step="1"
                        value={productEstimatorForm.blade_count}
                        onChange={(event) => setProductEstimatorForm((current) => ({ ...current, blade_count: event.target.value }))}
                        placeholder={`min ${bladeCountMinimum}`}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                      />
                      <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                        Minimum for your size: <strong>{bladeCountMinimum} blade{bladeCountMinimum === 1 ? "" : "s"}</strong>. {productBladeMaximum > 0 ? <>Maximum: <strong>{productBladeMaximum} blade{productBladeMaximum === 1 ? "" : "s"}</strong>. </> : null}Final count is confirmed by our team.
                      </span>
                    </>
                  ) : (
                    <span className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-700">
                      {effectiveBladeCount}
                    </span>
                  )}
                </label>
              </div>
            )}
            {(!isBladeProduct(selectedProduct) || productEstimatorForm.custom_frame_size) && (
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(88px,0.8fr)]">
              <label className="min-w-0">
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Width</span>
                <input
                  type="number"
                  min="1"
                  max="999"
                  step="any"
                  value={productEstimatorForm.width}
                  onChange={(event) => setProductEstimatorForm((current) => ({ ...current, width: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                />
              </label>
              <span className="mt-6 text-sm text-slate-400" aria-hidden="true">×</span>
              <label className="min-w-0">
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Height</span>
                <input
                  type="number"
                  min="1"
                  max="999"
                  step="any"
                  value={productEstimatorForm.height}
                  onChange={(event) => setProductEstimatorForm((current) => ({ ...current, height: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                />
              </label>
              <label className="col-span-3 min-w-0 sm:col-span-1">
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Unit</span>
                <CustomerDropdown
                  value={productEstimatorForm.unit}
                  onChange={(event) => setProductEstimatorForm((current) => ({ ...current, unit: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                >
                  <option value="in">in</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </CustomerDropdown>
              </label>
            </div>
            )}
            {!productEstimatorDimensionError && (isBladeProduct(selectedProduct)
              ? effectiveBladeCount >= bladeCountMinimum
                && (!productBladeMaximum || effectiveBladeCount <= productBladeMaximum)
                && (!selectedProduct.blade_glass_types?.length || Boolean(productEstimatorForm.blade_glass_type))
              : productEstimatorWidth > 0 && productEstimatorHeight > 0) ? (
              <div className="mt-4 space-y-3 text-sm text-slate-600" aria-live="polite">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2"><Ruler size={13} aria-hidden="true" />{isBladeProduct(selectedProduct) ? "Blade count" : "Area"}</span>
                  <span className="font-bold text-slate-900">
                    {isBladeProduct(selectedProduct)
                      ? productEstimatorResult?.areaDisplay
                      : Number(productEstimatorResult?.estimated_area) > 0
                      ? `${Number(productEstimatorResult.estimated_area).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq ft`
                      : productEstimatorResult?.areaDisplay || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Base Rate</span>
                  <span className="font-bold text-slate-900">
                    {Number(productEstimatorResult?.rate) > 0
                      ? `${formatCurrency(productEstimatorResult.rate)} / ${productEstimatorResult?.areaDisplay?.includes("blade") ? "blade" : Number(productEstimatorResult?.estimated_area) > 0 ? "sq ft" : "unit"}`
                      : "Contact us"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-3 py-3 text-red-800">
                  <span className="font-bold">Estimated Total</span>
                  <span className="text-base font-black">
                    {Number(productEstimatorResult?.estimated_price) > 0 ? formatCurrency(productEstimatorResult.estimated_price) : "Contact us"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 px-1">
                  <span>50% Downpayment</span>
                  <span className="font-bold text-red-800">
                    {Number(productEstimatorResult?.estimated_price) > 0 ? formatCurrency(productEstimatorResult.estimated_price * 0.5) : "Contact us"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex min-h-12 items-center justify-center rounded-lg bg-slate-50 px-3 py-2.5 text-center text-xs text-slate-500">
                {productEstimatorDimensionError || (isBladeProduct(selectedProduct) ? "Choose a glass type and valid blade count to calculate your estimate." : "Enter width &amp; height to calculate your estimate.")}
              </div>
            )}
            <p className="mt-2 text-[11px] font-semibold leading-4 text-slate-500">
              Final pricing is subject to negotiation during shop discussion or on-site inspection.
            </p>
          </section>}
          </>}
        </aside>
      </div>
      {hasStructuredProductModal && isBladeProduct(selectedProduct) && <div className="mx-[18px] mb-4 rounded-[14px] border border-slate-200 bg-white px-4 py-3.5 sm:mx-5">
        <h3 className="text-base font-bold text-slate-900">Product Details</h3>
        <p className="mt-1 whitespace-pre-line text-sm leading-5 text-slate-600">{selectedProduct.description || "No description available."}</p>
      </div>}
      {!isProductModalReadOnly && !isAreaProduct(selectedProduct) && (customerPermissions.can_estimate_pricing || customerPermissions.can_request_orders || pendingActionError) && <div className={`${hasStructuredProductModal ? "mx-[18px] mb-4 sm:mx-5" : "mx-4 mb-4 sm:mx-5 lg:mx-6"}`}>
        {productEstimatorContent}
      </div>}
      {canSeeCustomerRatings && customerPermissions.can_upload_feedback && (
        <section className="mx-4 mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white sm:mx-5 lg:mx-6" aria-labelledby="landing-product-ratings-heading">
            <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
              <h4 id="landing-product-ratings-heading" className="text-lg font-bold text-slate-900">Product Ratings</h4>
            </div>
            <div className="grid gap-4 border-b border-slate-100 bg-rose-50/40 p-4 sm:p-5 md:grid-cols-[190px_minmax(0,1fr)]">
              <div className="flex flex-col items-center justify-center border-b pb-4 text-center md:border-b-0 md:border-r md:pb-0 md:pr-5">
                {selectedProductReviewsLoading ? <p className="text-sm text-slate-500" role="status">Loading reviews...</p> : ratedLandingReviews.length ? <>
                  <p className="text-3xl font-bold text-red-600">{landingReviewAverage.toFixed(1)}<span className="text-base font-medium"> / 5</span></p>
                  <div className="mt-1 flex items-center gap-0.5 text-amber-500" aria-label={`${landingReviewAverage.toFixed(1)} out of 5 stars`}>{renderRatingStars(landingReviewAverage, 20)}</div>
                  <p className="mt-2 text-xs text-slate-500">{ratedLandingReviews.length} rating{ratedLandingReviews.length === 1 ? "" : "s"}</p>
                </> : <><p className="text-2xl font-bold text-slate-500">- <span className="text-sm font-medium">/ 5</span></p><p className="mt-2 text-xs text-slate-500">No ratings yet</p></>}
              </div>
              <div className="flex flex-wrap content-center gap-2" role="group" aria-label="Filter reviews by rating">
                <button type="button" onClick={() => setSelectedLandingReviewRatingTab(0)} aria-pressed={selectedLandingReviewRatingTab === 0} className={`rounded-md border px-3 py-2 text-xs font-semibold transition ${selectedLandingReviewRatingTab === 0 ? "border-red-600 bg-red-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-red-300"}`}>All ({selectedProductReviews.length})</button>
                {landingReviewCounts.map(({ star, count }) => <button key={star} type="button" onClick={() => setSelectedLandingReviewRatingTab(star)} aria-pressed={selectedLandingReviewRatingTab === star} className={`rounded-md border px-3 py-2 text-xs font-semibold transition ${selectedLandingReviewRatingTab === star ? "border-red-600 bg-red-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-red-300"}`}>{star} Star ({count})</button>)}
              </div>
            </div>
            {selectedProductReviewsLoading ? <p className="px-5 py-6 text-sm text-slate-500" role="status">Loading reviews...</p> : filteredLandingReviews.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">{selectedProductReviews.length === 0 ? "No reviews yet" : `No ${selectedLandingReviewRatingTab}-star reviews`}</p> : <div className="max-h-[55dvh] divide-y divide-slate-100 overflow-y-auto">
              {filteredLandingReviews.map((review, index) => <article key={`${review.orderId || index}-${review.submittedAt || index}`} className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600" aria-hidden="true">{String(review.customerName || "A").trim().charAt(0).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{review.customerName || "Anonymous"}</p><p className="mt-1 text-xs text-slate-500">{review.submittedAt ? new Date(review.submittedAt).toLocaleDateString("en-PH", { dateStyle: "medium" }) : "Date unavailable"}</p></div><div className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600"><span className="inline-flex items-center">{renderRatingStars(review.rating, 14)}</span><span>{Number(review.rating) > 0 ? `${Number(review.rating).toFixed(1)} / 5` : "No rating"}</span></div></div>
                    {review.title && <h5 className="mt-3 text-sm font-semibold text-slate-900">{review.title}</h5>}
                    <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-slate-700">{review.comment || "No review comment."}</p>
                    {review.photos?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{review.photos.map((photo, photoIndex) => <button key={`${photo}-${photoIndex}`} type="button" onClick={() => setLandingReviewPhotoPreview({ url: resolveBackendImageUrl(photo), index: photoIndex })} aria-label={`Open review photo ${photoIndex + 1}`} className="h-20 w-20 overflow-hidden rounded-lg border border-slate-200"><img src={resolveBackendImageUrl(photo)} alt={`Review photo ${photoIndex + 1}`} className="h-full w-full object-cover" loading="lazy" /></button>)}</div>}
                    {review.adminResponse && <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold text-slate-700">ACGC SERVICES</p><p className="mt-1 whitespace-pre-line break-words text-sm leading-5 text-slate-600">{review.adminResponse}</p></div>}
                  </div>
                </div>
              </article>)}
            </div>}
        </section>
      )}
      </div>
    </section>
    {landingReviewPhotoPreview && <div role="dialog" aria-modal="true" aria-label={`Review photo ${landingReviewPhotoPreview.index + 1} preview`} className="fixed inset-0 z-[160] flex items-center justify-center bg-black/90 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setLandingReviewPhotoPreview(null); }}>
      <button type="button" onClick={() => setLandingReviewPhotoPreview(null)} aria-label="Close photo preview" className="absolute right-4 top-4 rounded-full bg-white/15 p-3 text-white transition hover:bg-white/25"><X size={22} aria-hidden="true" /></button>
      <img src={landingReviewPhotoPreview.url} alt={`Customer review photo ${landingReviewPhotoPreview.index + 1}`} className="max-h-[90dvh] max-w-[96vw] rounded-lg object-contain" />
    </div>}
  </div>
), document.body)}

{showLoginRequired && (
  createPortal((
  <div className="customer-modal-overlay fixed inset-0 z-[130] flex min-h-dvh items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-action-login-required-title"
      className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <CircleAlert size={20} aria-hidden="true" />
        </span>
        <div>
          <h2 id="guest-action-login-required-title" className="text-lg font-bold text-slate-900">Login Required</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {loginRequiredAction === "order"
              ? "Log in or sign up for an account before placing your order."
              : "Log in or sign up for an account before adding products to your cart."}
          </p>
        </div>
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => {
            setShowLoginRequired(false);
            setPendingGuestCartAdd(null);
            if (pendingGuestOrderActionId) clearPendingProductAction(pendingGuestOrderActionId);
            setPendingGuestOrderActionId("");
          }}
          className="min-h-11 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:min-h-10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            setShowLoginRequired(false);
            navigate("/signup", {
              state: {
                from: loginRequiredAction === "order"
                  ? { pathname: "/customer-dashboard", search: "?tab=products&resumeLandingProduct=1" }
                  : { pathname: "/customer-dashboard", search: "?tab=cart" },
                pendingCartAdd: loginRequiredAction === "cart" ? pendingGuestCartAdd : undefined,
              },
            });
          }}
          className="min-h-11 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:min-h-10"
        >
          Sign Up
        </button>
        <button
          type="button"
          onClick={() => {
            setShowLoginRequired(false);
            navigate("/login", {
              state: {
                from: loginRequiredAction === "order"
                  ? { pathname: "/customer-dashboard", search: "?tab=products&resumeLandingProduct=1" }
                  : { pathname: "/customer-dashboard", search: "?tab=cart" },
                pendingCartAdd: loginRequiredAction === "cart" ? pendingGuestCartAdd : undefined,
              },
            });
          }}
          className="min-h-11 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 sm:min-h-10"
        >
          Log In
        </button>
      </div>
    </section>
  </div>
  ), document.body)
)}

{active === "track-order" && (
<section id="track-order" className="relative isolate scroll-mt-24 overflow-hidden bg-gradient-to-b from-rose-50/70 via-white to-white px-4 pb-16 pt-32 text-slate-900 sm:px-6 sm:pb-20">
  <div className="pointer-events-none absolute -right-32 top-20 size-96 rounded-full bg-red-100/50 blur-3xl" aria-hidden="true" />
  <div className="pointer-events-none absolute -left-40 bottom-0 size-96 rounded-full bg-blue-50/70 blur-3xl" aria-hidden="true" />
  <div className="relative mx-auto max-w-6xl">
    <header className="mx-auto mb-8 max-w-3xl text-center sm:mb-10">
      <span className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-white/80 px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-red-800 shadow-sm">
        <Truck size={14} aria-hidden="true" /> Project updates
      </span>
      <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">Track your order</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">Follow your project as it moves from inspection to fabrication and installation.</p>
    </header>

  <div className="overflow-hidden rounded-[28px] border border-slate-200/90 bg-white/95 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.09)] backdrop-blur sm:p-8">
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,1.15fr)] lg:items-end">
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-red-700 text-white shadow-lg shadow-red-900/15">
          <Truck size={22} aria-hidden="true" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-lg font-extrabold leading-tight text-slate-900">Track an Order</h3>
          <p className="mt-1.5 text-sm leading-6 text-slate-500">Enter your order tracking number or repair request ID to see its current status.</p>
        </div>
      </div>
      <form className="flex w-full flex-col gap-2.5 sm:flex-row" onSubmit={handleTrackOrder}>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Tracking ID</span>
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            placeholder="Enter tracking ID"
            className="h-12 w-full rounded-xl border border-slate-300 bg-slate-50/70 pl-11 pr-4 font-mono text-sm text-slate-900 outline-none transition duration-200 placeholder:font-sans placeholder:text-slate-400 focus:border-red-400 focus:bg-white focus:ring-4 focus:ring-red-100 motion-reduce:transition-none sm:h-14"
          />
        </label>
        <button type="submit" disabled={trackingLoading || !customerPermissions.can_track_products} className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-red-700 px-7 text-sm font-bold text-white shadow-lg shadow-red-900/15 transition duration-200 hover:-translate-y-0.5 hover:bg-red-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transition-none sm:h-14">
          {trackingLoading && <LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
          {trackingLoading ? "Searching..." : customerPermissions.can_track_products ? "Track" : "Tracking Disabled"}
        </button>
      </form>
    </div>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
      <p className="text-xs leading-5 text-slate-500">Your tracking ID is provided with your order details.</p>
      {!customerPermissions.can_track_products && <p className="text-xs font-semibold text-amber-700" role="status">Order tracking is currently unavailable.</p>}
    </div>
    {trackingError && <div role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800">{trackingError}</div>}
    {repairTrackingResult ? <OrderRepairProgress repairRequests={[repairTrackingResult]} /> : trackingResult && (
      <>
        <div className="mt-7 flex flex-col gap-4 rounded-2xl border border-red-100 bg-gradient-to-r from-red-50/80 via-white to-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-red-700 shadow-sm ring-1 ring-red-100"><Package size={20} aria-hidden="true" /></span>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-red-700">Order status</p>
              <h3 className="mt-1 text-xl font-black leading-tight text-slate-900 sm:text-2xl">Tracking Details</h3>
            </div>
          </div>
          {(() => {
            const StatusIcon = getStatusBadgeIcon(trackingResult.status);
            return (
              <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-xs font-extrabold capitalize shadow-sm ${getStatusBadgeClass(trackingResult.status)}`}>
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" />
                <StatusIcon size={16} aria-hidden="true" />
                {statusLabel(trackingResult.status)}
              </span>
            );
          })()}
        </div>

        <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5">
          <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.045)] sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-700 ring-1 ring-red-100">
                <Truck size={20} aria-hidden="true" />
              </div>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-red-700">Progress</p>
                <h4 className="mt-0.5 text-lg font-extrabold leading-tight text-slate-900">Order Timeline</h4>
              </div>
            </div>
            <OrderProgressTimeline order={trackingResult} />
            <div className="mt-5 grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-4 sm:gap-3 sm:p-4">
              <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-3">
                <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-500">Grand Total</p>
                <p className="mt-1.5 text-base font-black text-red-700 sm:text-lg"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(trackingPaymentSummary.totalAmount)}</span></p>
              </div>
              <div className="min-w-0 rounded-xl border border-emerald-100 bg-white p-3">
                <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-500">Amount Paid</p>
                <p className="mt-1.5 text-base font-black text-emerald-600 sm:text-lg"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(trackingPaymentSummary.paidAmount)}</span></p>
                <p className="mt-1 text-[9px] leading-4 text-slate-500">Required downpayment: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(trackingPaymentSummary.requiredAmount)}</span></p>
              </div>
              <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-3">
                <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-500">Balance</p>
                <p className="mt-1.5 text-base font-black text-slate-900 sm:text-lg"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(trackingPaymentSummary.remainingAmount)}</span></p>
              </div>
              <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-3">
                <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-500">Payment Status</p>
                <span className={`mt-2 ${statusBadgeBaseClassName} min-h-8 w-full px-2 text-center text-[10px] font-extrabold uppercase tracking-wide ${getPaymentStatusBadgeClassName(trackingPaymentSummary.status.key)}`}>
                  {getPaymentStatusLabel(trackingPaymentSummary.status)}
                </span>
              </div>
            </div>
          </section>

          <aside className="rounded-[26px] border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.045)] sm:p-5 lg:sticky lg:top-4">
            <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-slate-900 text-white"><Package size={18} aria-hidden="true" /></span>
              <div>
                <h4 className="text-base font-extrabold text-slate-900">Order Summary</h4>
                <p className="mt-0.5 text-xs text-slate-500">Customer and delivery details</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tracking ID</p>
                <p className="break-all font-mono text-[13px] font-medium text-slate-900">{trackingResult.tracking || trackingResult._id || "—"}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Customer</p>
                <p className="mt-1 break-words text-sm font-bold text-slate-900">{getOrderCustomerName(trackingResult)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Phone</p>
                <p className="break-words text-sm font-medium text-slate-900">{trackingResult.customer_phone || trackingResult.customer?.phone || "—"}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Order Date</p>
                <p className="mt-1 break-words text-sm font-semibold text-slate-900">{formatDateText(trackingResult.createdAt || trackingResult.created_at)}</p>
              </div>
              <div className="col-span-2 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Address</p>
                <p className="mt-1 break-words text-sm font-semibold leading-5 text-slate-900">{getOrderShippingAddress(trackingResult)}</p>
              </div>
            </div>

            <p className="mt-5 border-t border-slate-200 pt-4 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Products ({trackingResult.items?.length || 0})</p>
            <div>
              {trackingResult.items?.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllTrackedItems((visible) => !visible)}
                  aria-expanded={showAllTrackedItems}
                  className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-red-700 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 motion-reduce:transition-none"
                >
                  {showAllTrackedItems ? "Show less" : `Show all ${trackingResult.items.length}`}
                  {showAllTrackedItems ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                </button>
              )}
              {(trackingResult.items || []).slice(0, showAllTrackedItems ? undefined : 3).map((item, index) => {
                const itemName = item?.name || item?.product_name || `Product ${index + 1}`;
                const itemQty = Number(item?.quantity || item?.qty || 1);
                const itemTotal = getTrackedItemAmount(item);

                return (
                  <div key={`${item?.product_id || itemName}-${index}`} className="flex items-center justify-between gap-2.5 border-t border-slate-200 py-3 first:mt-2.5">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-slate-900">{itemName}</p>
                      <p className="mt-0.5 text-xs text-slate-500">Qty: {itemQty}</p>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-slate-900"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(itemTotal)}</span></span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-end justify-between gap-3 rounded-2xl border border-red-100 bg-red-50/60 px-4 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Items</p>
                <p className="mt-1 text-base font-black text-slate-900">{Array.isArray(trackingResult.items) ? trackingResult.items.length : 0}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total</p>
                <p className="mt-1 text-2xl font-black leading-tight text-red-700"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(getFinalProjectCost(trackingResult))}</span></p>
              </div>
            </div>
          </aside>
        </div>
      </>
    )}
  </div>
  </div>
</section>
)}


{/* ABOUT SECTION */}

{active === "about" && (
<section id="about" className="about-business-page scroll-mt-24">
  <AboutBusinessContent scrollCue={<LandingScrollCue reduceMotion={reduceMotion} targetId="about-details" label="Scroll down to more information" />} />
</section>
)}
{/* FOOTER */}

<footer className="relative left-1/2 mt-auto w-screen -translate-x-1/2 border-t border-white/15 bg-[#232b3d] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6 text-white">
  <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div className="grid gap-6 md:gap-8 lg:grid-cols-3">
      <div>
        <div className="flex items-center gap-3">
          <img src={logo} alt="logo" className="h-10 w-14 object-contain" />
          <div>
            <h3 className="text-base font-medium text-white">ACGC Aluminum Services</h3>
            <p className="text-xs text-slate-300">Premium Glass &amp; Aluminum Solutions</p>
          </div>
        </div>
      </div>

      <div>
        <h4 className="mb-3 text-sm font-medium text-white">Quick Links</h4>
        <nav aria-label="Footer quick links" className="space-y-2 text-xs text-slate-300">
          {[
            ["Home", "home"],
            ["Browse Products", "products"],
            ["Track Order", "track-order"],
            ["About Us", "about"],
          ].map(([label, sectionId]) => (
            <button key={sectionId} type="button" onClick={() => scrollToSection(sectionId)} className="block rounded-sm text-left transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none">
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div>
        <h4 className="mb-3 text-sm font-medium text-white">Contact</h4>
        <div className="space-y-2 text-xs text-slate-300">
          <a href={adminContactEmailHref} className="flex w-fit items-center gap-2 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <Mail size={15} aria-hidden="true" /><span>Email: {adminContactEmail}</span>
          </a>
          <a href={adminContactPhoneHref} className="flex w-fit items-center gap-2 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <Phone size={15} aria-hidden="true" /><span>Phone: {adminContactPhone}</span>
          </a>
          <a href={adminContactAddressHref} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-2 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <MapPin size={15} aria-hidden="true" /><span>{adminContactAddress}</span>
          </a>
          <a href="https://www.google.com/maps/search/?api=1&amp;query=Philippines" target="_blank" rel="noreferrer" className="flex w-fit items-center gap-2 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <MapPin size={15} aria-hidden="true" /><span>Philippines</span>
          </a>
        </div>
      </div>
    </div>

    <div className="mt-6 border-t border-white/15 pt-4 text-center text-[11px] text-slate-300">
      © 2026 ACGC Aluminum Services — All Rights Reserved.
    </div>
  </div>
</footer>

</div>
  );
}

export default LandingPage;
