import process from "node:process";
import { Buffer } from "node:buffer";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import ExtraChargeReceipt from "../models/ExtraChargeReceipt.js";
import ProjectPaymentReceipt from "../models/ProjectPaymentReceipt.js";
import ExtraCharge from "../models/ExtraCharge.js";
import SystemSetting from "../models/SystemSetting.js";
import ScheduleReservation from "../models/ScheduleReservation.js";
import CustomerNotification from "../models/CustomerNotification.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import Cart from "../models/Cart.js";
import { sendMail } from "../config/mailer.js";
import { formatOrderEmailDate, getCurrentCustomerContact, sendOrderNotification } from "../services/orderEmails.js";
import { buildFrontendUrl } from "../services/frontendUrl.js";
import { buildCustomerEmailTemplate } from "../services/customerEmailTemplate.js";
import { applyInstallationWarranty, isCompletedInstallationStage } from "../services/warranty.js";
import {
  applyInstallationNotificationTimestamps,
  buildInstallationNotificationEvents,
  isProgressStageCompleted,
} from "../services/installationNotifications.js";
import { buildProductPriceSnapshot, getMeasuredProductLineTotal } from "../../src/lib/productPricing.js";
import { toSquareFeet } from "../../src/lib/estimator.js";
import { calculateRequiredDownpayment, getFinalProjectCost, isProjectPriceLocked } from "../../src/lib/orderPricing.js";
import { getInstallationDateError } from "../../src/lib/installationSchedule.js";
import { getStreetAddressError, normalizeFullAddress } from "../utils/fullAddressValidation.js";
import { getProductEstimatorQuantityError } from "../utils/productEstimatorQuantity.js";
import {
  deletePrivatePaymentDocument,
  getPrivatePaymentDocumentDownloadUrl,
  uploadPrivatePaymentDocumentBuffer,
} from "../config/cloudinary.js";
import { getPaymentDocumentType } from "../services/paymentDocuments.js";
import { attachOrderScheduleOverdue } from "../services/orderScheduleOverdue.js";
import {
  getOrderPaymentAmounts,
  getOrderPaymentStatus,
  getDownpaymentExceptionSummary,
  initializePaymentLedger,
  isPaymentDiscrepancy,
  validateDownpaymentExceptionAcceptance,
  validateDownpaymentExceptionApproval,
  validatePaymentAmount,
} from "../services/paymentLedger.js";

const getBaseProjectCost = (order = {}) => getFinalProjectCost({ ...order, installation_extra_charge_total: 0 });

const isWithinReviewEditWindow = (submittedAt) => {
  if (!submittedAt) return false;
  const reviewDate = new Date(submittedAt);
  const editDeadline = new Date(reviewDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  return new Date() <= editDeadline;
};

const scheduleDateKey = (value) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};
const manilaTodayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const timeMinutes = (value) => { const match = String(value || "").match(/^(\d{2}):(\d{2})$/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };
const normalizeProjectCharges = (charges) => {
  if (!Array.isArray(charges)) return { error: "Additional project charges must be a list." };
  const normalized = [];
  for (const charge of charges) {
    const name = String(charge?.name || "").trim();
    const amount = Number(charge?.amount);
    if (!name || !Number.isFinite(amount) || amount < 0) return { error: "Each additional charge needs a description and a non-negative amount." };
    normalized.push({ name, amount, note: String(charge?.note || "").trim() });
  }
  return { charges: normalized };
};

const validateOrderSchedules = async (candidate, excludeOrderId = "", previous = null) => {
  const settings = await SystemSetting.findOne({ key: "global" }).select("business_hours").lean();
  const hours = settings?.business_hours || { open: "08:00", close: "18:00" };
  const open = timeMinutes(hours.open) ?? 480;
  const close = timeMinutes(hours.close) ?? 1080;
  const schedules = [
    { date: candidate.inspection_date, time: candidate.inspection_time, duration: Number(candidate.inspection_duration_minutes || 30) + Number(candidate.inspection_travel_minutes || 0), kind: "Inspection" },
    { date: candidate.estimated_installation_date, time: candidate.estimated_installation_time, duration: Number(candidate.installation_duration_minutes || 60), kind: "Installation" },
  ];
  const scheduleChanged = (schedule) => {
    if (!previous) return true;
    const oldDate = schedule.kind === "Inspection" ? previous.inspection_date : previous.estimated_installation_date;
    const oldTime = schedule.kind === "Inspection" ? previous.inspection_time : previous.estimated_installation_time;
    const oldDuration = schedule.kind === "Inspection"
      ? Number(previous.inspection_duration_minutes || 30) + Number(previous.inspection_travel_minutes || 0)
      : Number(previous.installation_duration_minutes || 60);
    return scheduleDateKey(schedule.date) !== scheduleDateKey(oldDate)
      || String(schedule.time || "") !== String(oldTime || "")
      || Number(schedule.duration) !== oldDuration;
  };
  for (const schedule of schedules) {
    if (!schedule.date && !schedule.time) continue;
    const isChanged = scheduleChanged(schedule);
    if (schedule.date && !schedule.time && isChanged) return `${schedule.kind} needs both a date and a start time.`;
    if (!schedule.date && schedule.time && isChanged) return `${schedule.kind} needs a date before selecting a start time.`;
    if (!schedule.date || !schedule.time) continue;
    const day = scheduleDateKey(schedule.date);
    const start = timeMinutes(schedule.time);
    if (start === null) return `${schedule.kind} time is invalid.`;
    const end = start + schedule.duration;
    if (isChanged && day < manilaTodayKey()) return `${schedule.kind} cannot be scheduled in the past.`;
    if (isChanged && day === manilaTodayKey()) {
      const nowTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
      if (start <= (timeMinutes(nowTime) ?? 0)) return `${schedule.kind} must start in the future (Asia/Manila).`;
    }
    const isMultiDayInstallation = schedule.kind === "Installation" && schedule.duration > close - open;
    if (isChanged && (start < open || (!isMultiDayInstallation && end > close))) return `${schedule.kind} must fit within business hours (${hours.open || "08:00"}–${hours.close || "18:00"}, Asia/Manila).`;
  }
  const active = schedules.filter((schedule) => schedule.date && schedule.time);
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (!scheduleChanged(active[i]) && !scheduleChanged(active[j])) continue;
      const firstStart = Date.parse(`${scheduleDateKey(active[i].date)}T00:00:00.000Z`) / 60_000 + timeMinutes(active[i].time);
      const secondStart = Date.parse(`${scheduleDateKey(active[j].date)}T00:00:00.000Z`) / 60_000 + timeMinutes(active[j].time);
      if (firstStart < secondStart + active[j].duration && firstStart + active[i].duration > secondStart) return "Inspection and installation schedules overlap for this project.";
    }
  }
  const activeChanges = active.filter(scheduleChanged);
  if (!activeChanges.length) return "";
  const otherOrders = await Order.find({ ...(excludeOrderId ? { _id: { $ne: excludeOrderId } } : {}), status: { $nin: ["cancelled", "canceled"] }, $or: [{ inspection_date: { $ne: null } }, { estimated_installation_date: { $ne: null } }] }).select("inspection_date inspection_time inspection_duration_minutes inspection_travel_minutes estimated_installation_date estimated_installation_time installation_duration_minutes status").lean();
  for (const schedule of activeChanges) {
    const start = Date.parse(`${scheduleDateKey(schedule.date)}T00:00:00.000Z`) / 60_000 + timeMinutes(schedule.time);
    const end = start + schedule.duration;
    for (const record of otherOrders) {
      const booked = [
        { date: record.inspection_date, time: record.inspection_time, duration: Number(record.inspection_duration_minutes || 30) + Number(record.inspection_travel_minutes || 0), kind: "Inspection" },
        { date: record.estimated_installation_date, time: record.estimated_installation_time, duration: Number(record.installation_duration_minutes || 60), kind: "Installation" },
      ];
      for (const slot of booked) {
        const bookedStart = timeMinutes(slot.time);
        if (bookedStart === null) continue;
        const absoluteBookedStart = Date.parse(`${scheduleDateKey(slot.date)}T00:00:00.000Z`) / 60_000 + bookedStart;
        if (start < absoluteBookedStart + slot.duration && end > absoluteBookedStart) return `${schedule.kind} overlaps another ${slot.kind} appointment. Choose another time.`;
      }
    }
  }
  return "";
};

const getOrderReservationKeys = (candidate) => {
  const keys = new Set();
  const schedules = [
    { date: candidate.inspection_date, time: candidate.inspection_time, minutes: Number(candidate.inspection_duration_minutes || 30) + Number(candidate.inspection_travel_minutes || 0) },
    { date: candidate.estimated_installation_date, time: candidate.estimated_installation_time, minutes: Number(candidate.installation_duration_minutes || 60) },
  ];
  for (const schedule of schedules) {
    const start = timeMinutes(schedule.time);
    const day = scheduleDateKey(schedule.date);
    if (!day || start === null || !schedule.minutes) continue;
    const origin = new Date(`${day}T00:00:00.000Z`).getTime() + start * 60_000;
    for (let offset = 0; offset < schedule.minutes; offset += 1) {
      const slot = new Date(origin + offset * 60_000);
      const date = slot.toISOString().slice(0, 10);
      const time = `${String(slot.getUTCHours()).padStart(2, "0")}:${String(slot.getUTCMinutes()).padStart(2, "0")}`;
      keys.add(`shared:${date}:${time}`);
    }
  }
  return [...keys];
};

const saveWithScheduleReservations = async (order, candidate, save, previousSchedule = null) => {
  const orderId = order._id;
  const nextKeys = getOrderReservationKeys(candidate);
  if (previousSchedule && JSON.stringify([...nextKeys].sort()) === JSON.stringify(getOrderReservationKeys(previousSchedule).sort())) {
    await save();
    return;
  }
  const existingKeys = await ScheduleReservation.find({ orderId }).distinct("_id");
  const existingSet = new Set(existingKeys);
  const addedKeys = nextKeys.filter((key) => !existingSet.has(key));
  try {
    if (addedKeys.length) await ScheduleReservation.insertMany(addedKeys.map((_id) => ({ _id, orderId })), { ordered: true });
  } catch (error) {
    await ScheduleReservation.deleteMany({ orderId, _id: { $in: addedKeys } });
    if (error?.code === 11000 || error?.writeErrors?.some((entry) => entry?.code === 11000)) {
      const conflict = new Error("This appointment time was just reserved by another booking. Choose an available time.");
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
  try {
    await save();
    await ScheduleReservation.deleteMany({ orderId, _id: { $nin: nextKeys } });
  } catch (error) {
    if (addedKeys.length) await ScheduleReservation.deleteMany({ orderId, _id: { $in: addedKeys } });
    throw error;
  }
};

const buildReviewNotificationMessage = (order, review, productName = order.items?.[0]?.name || "project") => {
  return `New customer review received for ${productName} (${order.tracking}).\nOrder ID: ${order.tracking || order._id}\nRating: ${"⭐".repeat(review.rating || 0)}\nTitle: ${review.title || "-"}\nComment: ${review.comment || "-"}`;
};

const privatePaymentDocumentsDirectory = path.resolve(process.cwd(), "private-payment-documents");
const RUSH_ORDER_DAILY_LIMIT = 2;
const RUSH_ORDER_TIME_ZONE = "Asia/Manila";

const getPhilippineDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: RUSH_ORDER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${values.year}-${values.month}-${values.day}`;
};

const clearGeneratedRescheduleDelay = (stages, resolvedAt = new Date()) => {
  let changed = false;
  (stages || []).forEach((stage) => {
    if (stage?.delayReason !== "Installation rescheduled"
      || stage?.delayNotes !== "Installation date changed in Progress Monitor.") return;
    const stageKey = String(stage.key || stage.name || "").toLowerCase().replace(/[\s-]+/g, "_");
    const isSchedulingStage = stageKey.includes("schedul");
    const isAcceptedSchedule = isSchedulingStage && stage.customerResponse === "accepted";
    stage.status = isAcceptedSchedule ? "done" : stage.installationStartedAt ? "in_progress" : "pending";
    stage.completed = isAcceptedSchedule;
    stage.delayReason = "";
    stage.delayExpectedResolution = null;
    stage.delayReportedAt = null;
    stage.delayReportedBy = "";
    stage.delayNotes = "";
    stage.delayHistory = (stage.delayHistory || []).map((entry) => (
      entry.reason === "Installation rescheduled"
        && entry.notes === "Installation date changed in Progress Monitor."
        && !entry.resolvedAt
        ? { ...entry, status: "resolved", resolvedAt }
        : entry
    ));
    changed = true;
  });
  return changed;
};

const getPhilippineDateRange = (value) => {
  const dateKey = getPhilippineDateKey(value);
  if (!dateKey) return null;
  const start = new Date(`${dateKey}T00:00:00+08:00`);
  return { dateKey, start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
};

const countSelectedRushItems = (items = []) => (Array.isArray(items) ? items : []).filter((item) => (
  Array.isArray(item?.extra_charges)
  && item.extra_charges.some((charge) => (
    charge?.is_active !== false
    && charge?.is_selected === true
    && /rush/i.test(String(charge?.name || charge?.label || ""))
  ))
)).length;

const countRushOrdersOnDate = async (value, excludedOrderId = null) => {
  const range = getPhilippineDateRange(value);
  if (!range) return 0;
  const orders = await Order.find({
    inspection_date: { $gte: range.start, $lt: range.end },
    ...(excludedOrderId ? { _id: { $ne: excludedOrderId } } : {}),
  }).select("status is_rush_order items.extra_charges").lean();
  return orders.reduce((total, order) => {
    if (/^(cancelled|canceled)$/i.test(String(order.status || ""))) return total;
    const isRushOrder = countSelectedRushItems(order.items) > 0;
    return total + (isRushOrder ? 1 : 0);
  }, 0);
};

const getOnlineOrderCooldownMessage = (cooldownUntil) => {
  const cooldownDate = new Intl.DateTimeFormat("en-PH", {
    timeZone: RUSH_ORDER_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(cooldownUntil);
  return `Online ordering is temporarily restricted after three order cancellations. You can place another online order after ${cooldownDate}. During this period, please visit our shop or contact us by phone.`;
};

const getPaymentDocumentDisplayName = (user) => [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.email || "Administrator";

const persistInstallationNotifications = async (order, stages, itemIndex = null, productName = "", { includeCompletion = true } = {}) => {
  if (!order?.customer || order.status === "cancelled") return;

  const events = buildInstallationNotificationEvents(stages, { itemIndex, productName })
    .filter((event) => includeCompletion || event.type !== "installation_completed");
  await Promise.all(events.map(async (event) => {
    try {
      const result = await CustomerNotification.updateOne(
        { order: order._id, eventKey: event.eventKey },
        { $setOnInsert: {
          customer: order.customer,
          order: order._id,
          eventKey: event.eventKey,
          type: event.type,
          title: event.title,
          message: event.message,
          tracking: order.tracking || "",
          stageKey: event.stageKey,
          stageName: event.stageName,
          itemIndex: event.itemIndex,
          productName: event.productName,
          completedAt: event.completedAt || null,
        } },
        { upsert: true }
      );
      if (result.upsertedCount > 0 || result.upsertedId) {
        void sendOrderNotification(event.type, order, {
          installationDate: event.installationDate || order.estimated_installation_date,
          completedAt: event.completedAt,
          productName: event.productName,
          itemIndex: event.itemIndex,
        });
      }
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }));
};

const orderWithCustomerNotifications = async (order) => {
  const responseOrder = order.toObject?.() || { ...order };
  if (order.customer) {
    responseOrder.customer_notifications = await CustomerNotification.find({
      customer: order.customer,
      order: order._id,
    }).sort({ createdAt: -1 }).lean();
  }
  return responseOrder;
};

export const addAdminPaymentSupportingDocument = async (req, res) => {
  let uploadedAsset = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Select a receipt or payment document to upload." });
    const fileType = getPaymentDocumentType(req.file.mimetype, req.file.buffer);
    if (!fileType) {
      return res.status(400).json({ success: false, message: "The file contents do not match a supported image or PDF document." });
    }
    const originalName = String(req.file.originalname || "").trim();
    const uploadId = String(req.body?.upload_id || "").trim();
    if (!originalName || originalName.length > 255) {
      return res.status(400).json({ success: false, message: "The document filename must be 1 to 255 characters." });
    }
    if (!/^[\w-]{8,100}$/.test(uploadId)) {
      return res.status(400).json({ success: false, message: "A valid upload ID is required." });
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    const paymentRecord = order.payment_records.id(req.params.recordId);
    if (!paymentRecord) return res.status(404).json({ success: false, message: "Payment record not found for this transaction." });
    const existingDocument = paymentRecord.supporting_documents.find((document) => document.client_upload_id === uploadId);
    if (existingDocument) return res.json({ success: true, duplicate: true, order });

    const documentId = randomUUID();
    const uploadedAt = new Date();
    let documentStorage;
    let storageKey = "";
    let publicId = "";
    let resourceType = fileType.resourceType;

    try {
      const cloudinaryAsset = await uploadPrivatePaymentDocumentBuffer(req.file.buffer, {
        publicId: `acgc/payment-proofs/admin/${order._id}/${paymentRecord._id}/${documentId}${fileType.resourceType === "raw" ? ".pdf" : ""}`,
        resourceType,
      });
      uploadedAsset = { publicId: cloudinaryAsset.public_id, resourceType };
      documentStorage = "cloudinary";
      publicId = cloudinaryAsset.public_id;
      resourceType = cloudinaryAsset.resource_type || resourceType;
    } catch (error) {
      if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") throw error;
      await fs.promises.mkdir(privatePaymentDocumentsDirectory, { recursive: true, mode: 0o700 });
      storageKey = `${documentId}${fileType.extension}`;
      await fs.promises.writeFile(path.join(privatePaymentDocumentsDirectory, storageKey), req.file.buffer, { flag: "wx", mode: 0o600 });
      documentStorage = "local";
    }

    paymentRecord.supporting_documents.push({
      client_upload_id: uploadId,
      original_name: originalName,
      public_id: publicId,
      resource_type: resourceType,
      format: fileType.format,
      storage: documentStorage,
      storage_key: storageKey,
      uploaded_by: req.user.id,
      uploaded_by_role: req.user.role,
      uploaded_by_name: getPaymentDocumentDisplayName(req.user),
      uploaded_at: uploadedAt,
    });
    try {
      await order.save();
    } catch (error) {
      if (uploadedAsset) {
        await deletePrivatePaymentDocument(uploadedAsset.publicId, uploadedAsset.resourceType).catch(() => undefined);
      } else if (storageKey) {
        await fs.promises.unlink(path.join(privatePaymentDocumentsDirectory, storageKey)).catch(() => undefined);
      }
      throw error;
    }
    return res.status(201).json({ success: true, order });
  } catch (error) {
    console.error("Add admin payment document error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Unable to save the payment document." });
  }
};

export const viewAdminPaymentSupportingDocument = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId).select("payment_records");
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    const paymentRecord = order.payment_records.id(req.params.recordId);
    const document = paymentRecord?.supporting_documents.id(req.params.documentId);
    if (!document) return res.status(404).json({ success: false, message: "Payment document not found." });

    if (document.storage === "cloudinary") {
      const downloadUrl = getPrivatePaymentDocumentDownloadUrl(document.public_id, document.format, document.resource_type);
      const cloudinaryResponse = await fetch(downloadUrl);
      if (!cloudinaryResponse.ok) return res.status(502).json({ success: false, message: "Unable to retrieve the private payment document." });
      const contentType = document.format === "pdf" ? "application/pdf" : `image/${document.format === "jpg" ? "jpeg" : document.format}`;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(document.original_name)}`);
      res.setHeader("Cache-Control", "private, no-store");
      return res.end(Buffer.from(await cloudinaryResponse.arrayBuffer()));
    }

    const filePath = path.resolve(privatePaymentDocumentsDirectory, document.storage_key);
    if (!filePath.startsWith(`${privatePaymentDocumentsDirectory}${path.sep}`)) {
      return res.status(404).json({ success: false, message: "Payment document not found." });
    }
    await fs.promises.access(filePath);
    res.setHeader("Content-Type", document.format === "pdf" ? "application/pdf" : `image/${document.format === "jpg" ? "jpeg" : document.format}`);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(document.original_name)}`);
    res.setHeader("Cache-Control", "private, no-store");
    return fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") return res.status(404).json({ success: false, message: "Payment document not found." });
    console.error("View admin payment document error:", error);
    return res.status(500).json({ success: false, message: "Unable to view the payment document." });
  }
};

export const viewCustomerPaymentSupportingDocument = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId).select("customer payment_records");
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    if (String(order.customer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Not authorized to view payment evidence for this order." });
    }
    const paymentRecord = order.payment_records.id(req.params.recordId);
    const document = paymentRecord?.supporting_documents.id(req.params.documentId);
    if (!document) return res.status(404).json({ success: false, message: "Payment document not found." });

    if (document.storage === "cloudinary") {
      const downloadUrl = getPrivatePaymentDocumentDownloadUrl(document.public_id, document.format, document.resource_type);
      const cloudinaryResponse = await fetch(downloadUrl);
      if (!cloudinaryResponse.ok) return res.status(502).json({ success: false, message: "Unable to retrieve the private payment document." });
      const contentType = document.format === "pdf" ? "application/pdf" : `image/${document.format === "jpg" ? "jpeg" : document.format}`;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(document.original_name)}`);
      res.setHeader("Cache-Control", "private, no-store");
      return res.end(Buffer.from(await cloudinaryResponse.arrayBuffer()));
    }

    const filePath = path.resolve(privatePaymentDocumentsDirectory, document.storage_key);
    if (!filePath.startsWith(`${privatePaymentDocumentsDirectory}${path.sep}`)) {
      return res.status(404).json({ success: false, message: "Payment document not found." });
    }
    await fs.promises.access(filePath);
    res.setHeader("Content-Type", document.format === "pdf" ? "application/pdf" : `image/${document.format === "jpg" ? "jpeg" : document.format}`);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(document.original_name)}`);
    res.setHeader("Cache-Control", "private, no-store");
    return fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") return res.status(404).json({ success: false, message: "Payment document not found." });
    console.error("View customer payment document error:", error);
    return res.status(500).json({ success: false, message: "Unable to view the payment document." });
  }
};

const getDelayEventKey = (stage, entry, index) => [
  stage.key || stage.name || index,
  entry.reportedAt ? new Date(entry.reportedAt).getTime() : "",
  entry.reason || "",
].join("|");

const isInstallationStage = (stage) => {
  const key = `${stage?.key || ""} ${stage?.name || ""}`.toLowerCase();
  return key.includes("installation") && !key.includes("schedul") && !key.includes("agreement");
};

const isStageInProgress = (stage) => ["in_progress", "in-progress", "active", "current"].includes(String(stage?.status || "").toLowerCase());

const getStageIdentity = (stage, index) => String(stage?.key || stage?.name || index).toLowerCase();

const normalizeAddress = (value) => {
  if (!value) return "";
  const cleaned = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[,;]+/g, ",")
    .replace(/\s*[.,]\s*/g, ", ")
    .replace(/\s*,\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const canonical = (text) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\b(city|province|zip|code|street|st|road|rd)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const normalizedParts = [];
  const seen = [];

  for (const part of parts) {
    const key = canonical(part);
    if (!key) {
      normalizedParts.push(part);
      continue;
    }
    const isDuplicate = seen.some(
      (existing) => existing === key || existing.includes(key) || key.includes(existing)
    );
    if (!isDuplicate) {
      seen.push(key);
      normalizedParts.push(part);
    }
  }

  return normalizedParts.join(", ");
};

const buildAddressFromUser = (user) => {
  if (!user) return "";
  return normalizeAddress(
    [user.street_address, user.city, user.province, user.zip_code].filter(Boolean).join(", ")
  );
};

const getLocalUploadedAttachment = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== "string") return null;
  try {
    const url = new URL(fileUrl, "http://localhost");
    const pathname = url.pathname || "";
    if (!pathname.startsWith("/uploads/")) return null;
    const filename = pathname.replace(/^\/uploads\//, "");
    if (!filename) return null;
    const filepath = path.join(process.cwd(), "uploads", filename);
    if (!fs.existsSync(filepath)) return null;
    return {
      filename,
      path: filepath,
    };
  } catch (err) {
    return null;
  }
};

const getDataUrlAttachment = (dataUrl, filename) => {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(application\/pdf|image\/png|image\/jpeg)(?:;filename=[^;]+)?;base64,(.+)$/s);
  if (!match) return null;
  return {
    filename,
    content: Buffer.from(match[2], "base64"),
    contentType: match[1],
  };
};

const normalizeProductId = (productId) => {
  if (!productId) return null;
  if (typeof productId === "object") {
    return String(productId._id || productId.id || productId);
  }
  return String(productId);
};

const getInspectionItemPricingSignature = (item = {}, { includeProductCharges = true } = {}) => {
  const dimensions = item.dimensions || {};
  const extraCharges = (Array.isArray(item.extra_charges) ? item.extra_charges : [])
    .map((charge) => ({
      key: String(charge?._id || charge?.name || charge?.label || ""),
      selected: charge?.is_optional === true ? charge?.is_selected === true : charge?.is_active !== false,
      amount: Number(charge?.amount) || 0,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const productCharges = (Array.isArray(item.additional_project_charges) ? item.additional_project_charges : [])
    .map((charge) => ({
      name: String(charge?.name || "").trim(),
      amount: Number(charge?.amount) || 0,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const doorMeasurement = item.door_measurement && typeof item.door_measurement === "object"
    ? {
      mode: item.door_measurement.mode === "custom" ? "custom" : "standard",
      actual_measurement_cm: Number(item.door_measurement.actual_measurement_cm) || 0,
    }
    : null;

  return JSON.stringify({
    product_id: normalizeProductId(item.product_id || item._id),
    quantity: Number(item.quantity ?? item.qty ?? dimensions.quantity) || 1,
    width: Number(item.width ?? dimensions.width) || 0,
    height: Number(item.height ?? dimensions.height) || 0,
    measurement_unit: item.measurement_unit || item.measurementUnit || dimensions.unit || "in",
    blade_glass_type: item.blade_glass_type || "",
    piece_option: item.piece_option || "",
    area_option: item.area_option || "",
    sale_mode: item.sale_mode || "",
    frame_type: item.frame_type || "",
    frame_price: Number(item.frame_price) || 0,
    custom_frame_size: Boolean(item.custom_frame_size),
    blade_count: Number(item.blade_count) || 0,
    estimation_mode: item.estimation_mode === "manual" ? "manual" : "auto",
    manual_estimated_total: Number(item.manual_estimated_total) || 0,
    door_measurement: doorMeasurement,
    extra_charges: extraCharges,
    ...(includeProductCharges ? { additional_project_charges: productCharges } : {}),
  });
};

const areInspectionItemsPricedTheSame = (requestedItems = [], savedItems = []) => (
  Array.isArray(requestedItems)
  && Array.isArray(savedItems)
  && requestedItems.length === savedItems.length
  && requestedItems.every((item, index) => getInspectionItemPricingSignature(item) === getInspectionItemPricingSignature(savedItems[index]))
);

const getProjectChargesTotal = (charges = []) => (
  (Array.isArray(charges) ? charges : []).reduce((sum, charge) => sum + Math.max(0, Number(charge?.amount) || 0), 0)
);

const getProjectChargePricingSignature = (charges = []) => JSON.stringify(
  (Array.isArray(charges) ? charges : [])
    .map((charge) => ({
      name: String(charge?.name || "").trim(),
      amount: Number(charge?.amount) || 0,
    }))
    .sort((left, right) => left.name.localeCompare(right.name)),
);

const getOrderItemPricingMethod = (product = {}, item = {}) => {
  const method = String(product.pricing_method || item.pricing_method || "").toLowerCase();
  if (method) return method;
  const unit = String(product.unit || item.unit || "").toLowerCase();
  if (unit === "per_blade") return "blade";
  if (unit === "per_sqft") return "sqft";
  return unit;
};

const hasValidDimensions = (item) =>
  Number(item.dimensions?.width) > 0 &&
  Number(item.dimensions?.height) > 0 &&
  Number(item.dimensions?.quantity) > 0 &&
  Boolean(item.dimensions?.unit);

const hasValidMeterLength = (item) =>
  Number(item.dimensions?.width) > 0 &&
  Number(item.dimensions?.quantity) > 0 &&
  Boolean(item.dimensions?.unit);

const requiresOrderItemDimensions = (product = {}, item = {}) => {
  const pricingMethod = getOrderItemPricingMethod(product, item);
  const isBladeProduct = pricingMethod === "blade" || pricingMethod === "per_blade";
  const isMeterProduct = pricingMethod === "per_meter" || pricingMethod === "meter";
  const isPieceProduct = ["per_piece", "piece", "per_set", "set"].includes(pricingMethod);
  return (!isBladeProduct && !isMeterProduct && !isPieceProduct)
    || (isBladeProduct && item.sale_mode === "frame" && Boolean(item.custom_frame_size));
};

const hasValidOrderItemPricingInput = (product = {}, item = {}) => {
  const pricingMethod = getOrderItemPricingMethod(product, item);
  const isFinishedDoor = product.finished_door_pricing?.enabled === true
    && /finished\s*door/i.test([product.product_type, product.product_name, product.name].filter(Boolean).join(" "));
  if (isFinishedDoor && item.door_measurement?.mode === "custom"
    && (!Number.isFinite(Number(item.door_measurement.actual_measurement_cm)) || Number(item.door_measurement.actual_measurement_cm) <= 0)) return false;
  const isBladeProduct = pricingMethod === "blade" || pricingMethod === "per_blade";
  if (pricingMethod === "per_meter" || pricingMethod === "meter") return hasValidMeterLength(item);
  if (["per_piece", "piece", "per_set", "set"].includes(pricingMethod)) return Number(item.dimensions?.quantity) > 0;
  if (!isBladeProduct) return hasValidDimensions(item);
  if (requiresOrderItemDimensions(product, item) && !hasValidDimensions(item)) return false;
  return Number(item.dimensions?.quantity) > 0 && Number(item.blade_count) > 0;
};

const sanitizeOrderItems = (items = []) => {
  return (items || []).map((item) => {
    const incomingDimensions = item.dimensions || {};
    if (item.is_estimate) {
      const estimatorQuantity = item.quantity ?? incomingDimensions.quantity;
      const quantityError = getProductEstimatorQuantityError(estimatorQuantity);
      if (quantityError) {
        const error = new Error(quantityError);
        error.statusCode = 400;
        throw error;
      }
    }
    const quantity = Number(item.quantity ?? incomingDimensions.quantity) || 1;
    const width = Number(incomingDimensions.width ?? item.width) || 0;
    const height = Number(incomingDimensions.height ?? item.height) || 0;
    const measurement_unit = incomingDimensions.unit || item.measurement_unit || item.measurementUnit || "in";
    const area = Number(item.area) || 0;
    const productUnitPrice = Number(item.product_id?.unit_price ?? item.product?.unit_price ?? item.base_price ?? item.price ?? item.unit_price ?? 0) || 0;
    const productRatePerSqft = Number(item.product_id?.price_per_sqft ?? item.product?.price_per_sqft ?? item.price_per_sqft ?? 0) || 0;
    const unit_price = Number(item.unit_price) || productUnitPrice || (productRatePerSqft > 0 && area > 0 ? productRatePerSqft * area : 0);
    const estimated_price = item.is_estimate
      ? Number(item.estimated_price) || Number(item.manual_estimated_total) || area * (productRatePerSqft || unit_price || 0)
      : 0;
    const estimation_mode = item.estimation_mode === "manual" ? "manual" : "auto";
    const manual_estimated_total = Number(item.manual_estimated_total) || 0;
    const customized = Boolean(incomingDimensions.customized ?? item.customized ?? item.is_estimate);
    const normalizedProductCharges = normalizeProjectCharges(item.additional_project_charges || []);
    if (normalizedProductCharges.error) {
      const error = new Error(normalizedProductCharges.error);
      error.statusCode = 400;
      throw error;
    }

    return {
      product_id: normalizeProductId(item.product_id) || normalizeProductId(item._id) || null,
      name: item.name,
      quantity,
      unit_price,
      pricing_method: item.pricing_method || "",
      price_per_sqft: Number(item.price_per_sqft) || 0,
      price_per_blade: Number(item.price_per_blade) || 0,
      blade_glass_type: item.blade_glass_type || "",
      piece_option: item.piece_option || "",
      area_option: item.area_option || "",
      sale_mode: item.sale_mode || "",
      frame_type: item.frame_type || "",
      frame_price: Number(item.frame_price) || 0,
      custom_frame_size: Boolean(item.custom_frame_size),
      blade_glass_types: Array.isArray(item.blade_glass_types) ? item.blade_glass_types : [],
      piece_options: Array.isArray(item.piece_options) ? item.piece_options : [],
      area_options: Array.isArray(item.area_options) ? item.area_options : [],
      sell_blades_only: item.sell_blades_only !== false,
      sell_with_frame: Boolean(item.sell_with_frame),
      blade_frame_types: Array.isArray(item.blade_frame_types) ? item.blade_frame_types : [],
      allow_custom_frame_size: Boolean(item.allow_custom_frame_size),
      custom_frame_size_unit: item.custom_frame_size_unit || item.measurement_unit || measurement_unit,
      minimum_blades: Math.max(1, Number(item.minimum_blades) || 1),
      maximum_blades: Number(item.maximum_blades) || 0,
      customer_can_choose_blade_count: Boolean(item.customer_can_choose_blade_count),
      default_blade_glass_type: item.default_blade_glass_type || "",
      default_sale_mode: item.default_sale_mode || "",
      default_frame_type: item.default_frame_type || "",
      show_price_per_blade: item.show_price_per_blade !== false,
      base_price: Number(item.base_price) || 0,
      blade_count: Number(item.blade_count) || 0,
      estimated_price_override: Number(item.estimated_price_override) || 0,
      customization: Boolean(item.customization),
      customization_fee: Number(item.customization_fee) || 0,
      extra_charges: Array.isArray(item.extra_charges) ? item.extra_charges : [],
      additional_project_charges: normalizedProductCharges.charges,
      size_limits: item.size_limits || {},
      door_measurement: item.door_measurement && typeof item.door_measurement === "object" ? {
        mode: item.door_measurement.mode === "custom" ? "custom" : "standard",
        actual_measurement_cm: Number(item.door_measurement.actual_measurement_cm),
      } : null,
      line_total: Number(item.line_total) || 0,
      unit: item.unit || "piece",
      category: item.category || "",
      product_type: item.product_type || "",
      measurement_unit,
      width,
      height,
      dimensions: {
        width,
        height,
        unit: measurement_unit,
        quantity,
        customized,
      },
      area,
      estimated_price,
      estimation_mode,
      manual_estimated_total,
      notes: item.notes || "",
      warranty_period: item.warranty_period !== undefined ? String(item.warranty_period) : "",
      custom_warranty_days: Number(item.custom_warranty_days) > 0 ? Number(item.custom_warranty_days) : null,
      warranty_start_date: item.warranty_start_date ? new Date(item.warranty_start_date) : null,
      warranty_expiry_date: item.warranty_expiry_date ? new Date(item.warranty_expiry_date) : null,
      warranty_status: item.warranty_status || "",
      customized,
      is_estimate: Boolean(item.is_estimate),
    };
  });
};

const getItemAmountValue = (item) => {
  if (!item) return 0;

  let itemAmount = 0;
  if (Number(item.line_total) > 0) {
    itemAmount = Number(item.line_total);
  } else if (item.is_estimate && Number(item.estimated_price || item.manual_estimated_total || 0) > 0) {
    itemAmount = Number(item.estimated_price || item.manual_estimated_total || 0);
  } else {
    const quantity = Number(item.quantity || 1) || 1;
    const unitPrice = Number(item.unit_price || 0) || 0;
    const area = Number(item.area || 0) || 0;
    const productRate = Number(item.price_per_sqft || item.product?.price_per_sqft || 0) || 0;
    itemAmount = productRate > 0 && area > 0 ? productRate * area : unitPrice * quantity;
  }

  const productCharges = (Array.isArray(item.additional_project_charges) ? item.additional_project_charges : [])
    .reduce((sum, charge) => sum + Math.max(0, Number(charge.amount) || 0), 0);
  return itemAmount + productCharges;
};

// Reprice against the current catalog when creating a new order. The returned
// amount includes only required extras and optional extras selected by the
// customer, using catalog amounts rather than values supplied by the browser.
const getCatalogProductLineTotal = (product = {}, item = {}) => {
  return getMeasuredProductLineTotal(product, item);
};

const getManualInspectionExtraChargeTotal = (item = {}, manualTotal = 0) => {
  const quantity = Number(item.quantity ?? item.qty ?? 1) || 1;
  const area = Math.round((toSquareFeet(
    Number(item.width ?? item.dimensions?.width) || 0,
    Number(item.height ?? item.dimensions?.height) || 0,
    item.measurement_unit || item.measurementUnit || item.dimensions?.unit || "in",
  ) * quantity) * 100) / 100;
  return (Array.isArray(item.extra_charges) ? item.extra_charges : []).reduce((sum, charge) => {
    if (charge?.is_active === false || (charge?.is_optional === true && charge?.is_selected !== true)) return sum;
    const amount = Math.max(0, Number(charge?.amount) || 0);
    if (charge?.type === "percentage") return sum + (manualTotal * amount / 100);
    if (charge?.type === "per_sqft") return sum + area * amount;
    if (charge?.type === "per_blade") return sum + (Number(item.blade_count) || 0) * amount * quantity;
    return sum + amount * quantity;
  }, 0);
};

const applyCatalogExtraChargeSelections = (product = {}, item = {}, { allowAmountOverrides = false } = {}) => {
  const catalogCharges = Array.isArray(product.extra_charges) ? product.extra_charges : [];
  const requestedCharges = Array.isArray(item.extra_charges) ? item.extra_charges : [];
  const extra_charges = catalogCharges.map((charge, index) => {
    const chargeId = String(charge?._id || "");
    const requested = (chargeId && requestedCharges.find((entry) => String(entry?._id || "") === chargeId))
      || requestedCharges.find((entry) => entry?.name && entry.name === charge.name)
      || requestedCharges[index];
    return {
      ...charge,
      amount: allowAmountOverrides
        && Number.isFinite(Number(requested?.amount))
        && Number(requested.amount) >= 0
        ? Number(requested.amount)
        : charge.amount,
      // Charge labels, types, and amounts come from the catalog. The customer
      // can submit only the selection state, never a client-supplied amount.
      is_selected: charge?.is_optional === true
        ? requested?.is_selected === true && charge?.is_active !== false
        : charge?.is_active !== false,
    };
  });
  return { ...item, extra_charges };
};

const repriceInspectionItems = async (items) => {
  const requestedItems = Array.isArray(items) ? items : [];
  for (const [index, item] of requestedItems.entries()) {
    const requestedQuantity = item?.qty ?? item?.quantity ?? item?.dimensions?.quantity;
    if (requestedQuantity === "" || requestedQuantity === null || requestedQuantity === undefined || !Number.isFinite(Number(requestedQuantity)) || Number(requestedQuantity) <= 0) {
      const error = new Error(`Measurement ${index + 1}: quantity must be greater than zero.`);
      error.statusCode = 400;
      throw error;
    }
  }
  const sanitizedItems = sanitizeOrderItems(items);
  const productIds = [...new Set(sanitizedItems.map((item) => item.product_id).filter(Boolean))];
  if (sanitizedItems.some((item) => !item.product_id || !mongoose.Types.ObjectId.isValid(item.product_id))) {
    const error = new Error("Each inspection item must reference a valid product.");
    error.statusCode = 400;
    throw error;
  }
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } })
        .select("pricing_method unit unit_price base_price price_per_sqft price_per_blade blade_count blade_glass_types piece_options area_options sell_blades_only sell_with_frame blade_frame_types allow_custom_frame_size custom_frame_price minimum_blades maximum_blades customer_can_choose_blade_count default_blade_glass_type default_sale_mode default_frame_type show_price_per_blade customization customization_fee extra_charges size_limits estimated_price estimated_price_override width height measurement_unit product_type product_name name finished_door_pricing")
        .lean()
    : [];
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  if (productsById.size !== productIds.length) {
    const error = new Error("One or more inspection products no longer exist. Refresh the inspection and select an available product.");
    error.statusCode = 400;
    throw error;
  }

  return sanitizedItems.map((item, index) => {
    const product = productsById.get(String(item.product_id));
    if (!String(item.name || "").trim()) {
      const error = new Error(`Measurement ${index + 1}: product description is required.`);
      error.statusCode = 400;
      throw error;
    }
    const pricingMethod = getOrderItemPricingMethod(product, item);
    if (product.finished_door_pricing?.enabled === true && /finished\s*door/i.test([product.product_type, product.product_name, product.name].filter(Boolean).join(" "))) {
      const mode = item.door_measurement?.mode === "custom" ? "custom" : "standard";
      const standard = Number(product.finished_door_pricing.standard_size_cm) || 190;
      const actual = mode === "custom" ? Number(item.door_measurement?.actual_measurement_cm) : standard;
      if (!Number.isFinite(actual) || actual <= 0) {
        const error = new Error(`Measurement ${index + 1}: custom door measurement must be greater than zero.`);
        error.statusCode = 400;
        throw error;
      }
    }
    const requiredDimensions = pricingMethod === "per_meter" || pricingMethod === "meter"
      ? [["width", "Length"]]
      : requiresOrderItemDimensions(product, item)
        ? [["width", "Width"], ["height", "Height"]]
        : [];
    for (const [field, label] of requiredDimensions) {
      if (!Number.isFinite(Number(item[field])) || Number(item[field]) <= 0) {
        const error = new Error(`Measurement ${index + 1}: ${label} must be greater than zero.`);
        error.statusCode = 400;
        throw error;
      }
    }
    if ((pricingMethod === "blade" || pricingMethod === "per_blade") && (!item.blade_glass_type || Number(item.blade_count) < 1)) {
      const error = new Error(`Measurement ${index + 1}: select a glass type and valid blade count.`);
      error.statusCode = 400;
      throw error;
    }
    const pieceOptions = Array.isArray(product.piece_options) ? product.piece_options : [];
    if (["per_piece", "piece", "per_set", "set"].includes(pricingMethod) && pieceOptions.length
      && item.piece_option && !pieceOptions.some((option) => option.name === item.piece_option && Number(option.price_per_piece) > 0)) {
      const error = new Error(`Measurement ${index + 1}: select a valid per-piece option.`);
      error.statusCode = 400;
      throw error;
    }
    const areaOptions = Array.isArray(product.area_options) ? product.area_options : [];
    const selectedAreaOption = String(item.area_option || "").trim();
    if (["sqft", "per_sqft"].includes(pricingMethod) && areaOptions.length
      && selectedAreaOption
      && !areaOptions.some((option) => option.name === selectedAreaOption
        && (Number(option.price_per_sqft) > 0 || Number(product.price_per_sqft) > 0 || Number(product.estimated_price_override) > 0))) {
      const error = new Error(`Measurement ${index + 1}: select a valid variant.`);
      error.statusCode = 400;
      throw error;
    }
    const pricedItem = applyCatalogExtraChargeSelections(product, item, { allowAmountOverrides: true });

    const priceSnapshot = buildProductPriceSnapshot(product, pricedItem);
    const isConfiguredFinishedDoor = product.finished_door_pricing?.enabled === true
      && /finished\s*door/i.test([product.product_type, product.product_name, product.name].filter(Boolean).join(" "));
    const itemOverride = !isConfiguredFinishedDoor && pricedItem.estimation_mode === "manual"
      ? Number(pricedItem.manual_estimated_total) || 0
      : 0;
    const lineTotal = itemOverride > 0
      ? Math.round((itemOverride + getManualInspectionExtraChargeTotal(pricedItem, itemOverride)) * 100) / 100
      : getCatalogProductLineTotal(product, pricedItem);

    return {
      ...pricedItem,
      ...priceSnapshot,
      door_measurement: priceSnapshot.door_measurement,
      // Keep admin-entered charge amounts from the sanitized inspection item.
      // The product price snapshot is for pricing fields and must not restore catalog defaults.
      extra_charges: pricedItem.extra_charges,
      estimated_price: lineTotal,
      line_total: lineTotal,
    };
  });
};

const generateTrackingNumber = () => {
  return `TRK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
};

const getInstallationPlan = (order) => {
  const stages = Array.isArray(order?.progress_stages) ? order.progress_stages : [];
  const stage = stages.find((entry) => {
    const key = `${entry.key || ""} ${entry.name || ""}`.toLowerCase();
    return key.includes("installation") && (entry.proposedInstallationDate || entry.proposedInstallationTime);
  });
  return {
    date: stage?.proposedInstallationDate || order?.estimated_installation_date || order?.inspection_date || null,
    time: stage?.proposedInstallationTime || "",
    status: stage?.status || (stage?.customerResponse === "accepted" ? "Confirmed" : "Scheduled"),
  };
};


const getWarrantyEmailLines = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const assignedItems = items.filter((item) => item.warranty_start_date || item.warranty_expiry_date || item.warranty_status);
  const formatWarranty = (item, name) => {
    const start = item.warranty_start_date || order.warranty_start_date;
    const end = item.warranty_expiry_date || order.warranty_expiry_date;
    const period = item.warranty_period || order.warranty_period || "Warranty coverage";
    const status = String(item.warranty_status || order.warranty_status || "Active").replace(/_/g, " ");
    const remainingDays = end ? Math.max(Math.ceil((new Date(end).getTime() - Date.now()) / 86400000), 0) : null;
    const remaining = remainingDays === null || status === "expired" ? "" : `; ${remainingDays} day${remainingDays === 1 ? "" : "s"} remaining`;
    return `${name}: ${period}; starts ${formatOrderEmailDate(start) || "not specified"}; ends ${formatOrderEmailDate(end) || "not specified"}; status ${status}${remaining}`;
  };
  if (assignedItems.length > 0) {
    return assignedItems.map((item, index) => formatWarranty(item, item.name || `Product ${index + 1}`));
  }
  if (order?.warranty_start_date || order?.warranty_expiry_date || order?.warranty_status) {
    return [formatWarranty(order, "Order coverage")];
  }
  return [];
};

export const listOrders = async (req, res) => {
  try {
    const filter = {};

    if (!["admin", "super_admin"].includes(req.user.role)) {
      filter.customer = req.user.id;
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate("customer", "first_name last_name email phone street_address city province zip_code customer_cancellation_count online_order_cooldown_until")
      .populate("items.product_id", "image_url image images name product_name category product_type unit pricing_method unit_price base_price price_per_sqft price_per_blade blade_count blade_glass_types piece_options area_options sell_blades_only sell_with_frame blade_frame_types allow_custom_frame_size custom_frame_price minimum_blades maximum_blades customer_can_choose_blade_count default_blade_glass_type default_sale_mode default_frame_type show_price_per_blade customization customization_fee extra_charges size_limits estimated_price estimated_price_override estimated_area width height measurement_unit standard_size finished_door_pricing")
      .lean();

    orders.forEach(attachOrderScheduleOverdue);

    // Preserve the running balance written by Save draft, while using charge
    // records to recover older issued charges missing from an Order snapshot.
    if (req.user.role === "customer" && orders.length > 0) {
      const chargeRecords = await ExtraCharge.find({
        order: { $in: orders.map((order) => order._id) },
        status: { $in: ["Approved", "Receipt Generated"] },
      }).select("order total payments").lean();
      const totalsByOrder = new Map();
      const paidByOrder = new Map();
      chargeRecords.forEach((charge) => {
        const key = String(charge.order);
        const total = Math.max(Number(charge.total) || 0, 0);
        const paid = (charge.payments || []).reduce((sum, payment) => (
          payment.status === "verified" ? sum + Math.max(Number(payment.amount) || 0, 0) : sum
        ), 0);
        totalsByOrder.set(key, Math.round(((totalsByOrder.get(key) || 0) + total) * 100) / 100);
        paidByOrder.set(key, Math.round(((paidByOrder.get(key) || 0) + paid) * 100) / 100);
      });
      orders.forEach((order) => {
        const key = String(order._id);
        // Keep the persisted running balance (which is incremented on every
        // Save draft) and use charge records to fill any older missing totals.
        order.installation_extra_charge_total = Math.max(
          Number(order.installation_extra_charge_total) || 0,
          totalsByOrder.get(key) || 0,
        );
        order.installation_extra_charge_paid_total = Math.max(
          Number(order.installation_extra_charge_paid_total) || 0,
          paidByOrder.get(key) || 0,
        );
      });
    }

    if (req.user.role === "customer" && orders.length > 0) {
      orders.forEach((order) => {
        delete order.progress_notes;
        delete order.progress_audit;
        delete order.protected_project_notes;
        delete order.progress_activity_notes;
        (order.items || []).forEach((item) => {
          delete item.progress_notes;
          delete item.progress_audit;
          delete item.protected_project_notes;
          delete item.progress_activity_notes;
        });
        (order.payment_records || []).forEach((record) => {
          record.supporting_documents = (record.supporting_documents || []).map((document) => ({
            _id: document._id,
            original_name: document.original_name,
            format: document.format,
            uploaded_by_role: document.uploaded_by_role,
            uploaded_by_name: document.uploaded_by_name,
            uploaded_at: document.uploaded_at,
          }));
        });
      });
      const notifications = await CustomerNotification.find({
        customer: req.user.id,
        order: { $in: orders.map((order) => order._id) },
      }).sort({ createdAt: -1 }).lean();
      const notificationsByOrder = new Map();
      notifications.forEach((notification) => {
        const orderId = String(notification.order);
        const orderNotifications = notificationsByOrder.get(orderId) || [];
        orderNotifications.push(notification);
        notificationsByOrder.set(orderId, orderNotifications);
      });
      orders.forEach((order) => {
        order.customer_notifications = notificationsByOrder.get(String(order._id)) || [];
      });
    }

    res.json({ success: true, orders });
  } catch (error) {
    console.error("List orders error:", error);
    res.status(500).json({ success: false, message: "Unable to list orders", error: error.message });
  }
};

export const createOrder = async (req, res) => {
  try {
    const { items, shipping_address, customer_phone, order_type } = req.body;
    const customerAccount = await User.findById(req.user.id).select("online_order_cooldown_until").lean();
    if (customerAccount?.online_order_cooldown_until && new Date(customerAccount.online_order_cooldown_until) > new Date()) {
      return res.status(423).json({
        success: false,
        code: "ONLINE_ORDER_COOLDOWN",
        message: getOnlineOrderCooldownMessage(new Date(customerAccount.online_order_cooldown_until)),
        cooldown_until: customerAccount.online_order_cooldown_until,
      });
    }
    const requestedCartItemIds = Array.isArray(req.body.cart_item_ids)
      ? [...new Set(req.body.cart_item_ids.map((cartId) => String(cartId || "").trim()).filter(Boolean))]
      : [];

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "Order items are required" });
    }

    if (requestedCartItemIds.length > 0) {
      const cart = await Cart.findOne({ customer: req.user.id }).select("items.cartId").lean();
      const availableCartIds = new Set((cart?.items || []).map((item) => String(item.cartId)));
      if (requestedCartItemIds.some((cartId) => !availableCartIds.has(cartId))) {
        return res.status(409).json({ success: false, message: "Your cart changed. Refresh it and try checkout again." });
      }
    }

    const sanitizedItems = sanitizeOrderItems(items);
    const productIds = [...new Set(sanitizedItems.map((item) => item.product_id).filter(Boolean))];
    if (
      productIds.length !== sanitizedItems.length ||
      productIds.some((productId) => !mongoose.Types.ObjectId.isValid(productId))
    ) {
      return res.status(400).json({ success: false, message: "Each order item must reference a valid product." });
    }

    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds }, is_active: { $ne: false } })
          .select("name product_name product_type finished_door_pricing pricing_method unit unit_price base_price price_per_sqft price_per_blade blade_count blade_glass_types piece_options area_options sell_blades_only sell_with_frame blade_frame_types allow_custom_frame_size custom_frame_price minimum_blades maximum_blades customer_can_choose_blade_count default_blade_glass_type default_sale_mode default_frame_type show_price_per_blade customization customization_fee extra_charges estimated_price estimated_price_override width height measurement_unit")
          .lean()
      : [];
    const productsById = new Map(products.map((product) => [String(product._id), product]));
    if (productsById.size !== productIds.length) {
      return res.status(400).json({ success: false, message: "One or more selected products are no longer available." });
    }
    const hasInvalidPricingInput = sanitizedItems.some((item) => {
      const product = productsById.get(String(item.product_id));
      return !hasValidOrderItemPricingInput(product, item);
    });

    if (hasInvalidPricingInput) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid product dimensions before submitting your order.",
      });
    }
    const hasInvalidAreaOption = sanitizedItems.some((item) => {
      const product = productsById.get(String(item.product_id));
      const pricingMethod = getOrderItemPricingMethod(product, item);
      const areaOptions = Array.isArray(product?.area_options) ? product.area_options : [];
      const selectedAreaOption = String(item.area_option || "").trim();
      return ["sqft", "per_sqft"].includes(pricingMethod)
        && areaOptions.length > 0
        && Boolean(selectedAreaOption)
        && !areaOptions.some((option) => option.name === selectedAreaOption
          && (Number(option.price_per_sqft) > 0 || Number(product?.price_per_sqft) > 0 || Number(product?.estimated_price_override) > 0));
    });

    if (hasInvalidAreaOption) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid variant before submitting your order.",
      });
    }

    const pricedItems = sanitizedItems.map((item) => {
      const product = productsById.get(String(item.product_id));
      const pricedItem = applyCatalogExtraChargeSelections(product, item);
      const priceSnapshot = buildProductPriceSnapshot(product, pricedItem);
      const lineTotal = getCatalogProductLineTotal(product, pricedItem);
      return {
        ...pricedItem,
        ...priceSnapshot,
        estimated_price: lineTotal,
        line_total: lineTotal,
      };
    });

    const total_amount = pricedItems.reduce((sum, item) => sum + getItemAmountValue(item), 0);
    const requiredDownpayment = calculateRequiredDownpayment(total_amount, "50%_down_payment");
    const normalizedShippingAddress = normalizeAddress(shipping_address || buildAddressFromUser(req.user));
    const shippingAddressError = getStreetAddressError(normalizedShippingAddress);
    if (shippingAddressError) return res.status(400).json({ success: false, message: shippingAddressError });

    const order = new Order({
      customer: req.user.id,
      cart_item_ids: requestedCartItemIds,
      customer_name: [req.user.first_name, req.user.last_name].filter(Boolean).join(" "),
      customer_email: req.user.email || "",
      customer_phone: String(customer_phone || req.user.phone || "").trim(),
      items: pricedItems,
      total_amount,
      estimated_cost: total_amount,
      final_project_cost: total_amount,
      payment_terms: "50%_down_payment",
      downpayment_amount: requiredDownpayment,
      required_downpayment_amount: requiredDownpayment,
      amount_paid: 0,
      shipping_address: normalizedShippingAddress,
      tracking: generateTrackingNumber(),
      order_type: order_type === "walk_in_customer" ? "walk_in_customer" : "online_order",
      contract_status: "pending",
      payment_status: "pending",
      status: "site_inspection",
    });

    await order.save();

    let cartCleanupPending = false;
    if (requestedCartItemIds.length > 0) {
      try {
        await Cart.updateOne(
          { customer: req.user.id },
          { $pull: { items: { cartId: { $in: requestedCartItemIds } } } }
        );
      } catch (cartError) {
        cartCleanupPending = true;
        console.error("Cart cleanup after checkout failed; purchased IDs will be excluded on future cart reads:", cartError);
      }
    }

    res.status(201).json({ success: true, order, cart_cleanup_pending: cartCleanupPending });
    void sendOrderNotification("order_submitted", order, { customerEmail: req.user.email });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ success: false, message: "Unable to create order", error: error.message });
  }
};

export const createOrderAsAdmin = async (req, res) => {
  try {
    const { 
      items, 
      shipping_address, 
      order_type, 
      attachments, 
      payment_terms,
      agreed_payment_date,
      customer_name, 
      customer_phone, 
      customer_email, 
      customer_id,
      has_account_on_website,
      downpayment_received,
      warranty_period,
      custom_warranty_days,
      warranty_assignment_mode,
      required_downpayment_amount,
      // Walk-in customer fields
      signed_contract_url,
      contract_number,
      contract_signed_date,
      inspection_date,
      inspection_time,
      inspection_duration_minutes = 30,
      inspection_travel_minutes = 0,
      estimated_installation_date,
      estimated_installation_time,
      installation_duration_minutes = 60,
      project_additional_charges = [],
      inspection_notes,
      is_rush_order,
    } = req.body;

    const isValidScheduleTime = (value) => value === undefined || value === null || value === "" || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value));
    if (!isValidScheduleTime(inspection_time) || !isValidScheduleTime(estimated_installation_time)) {
      return res.status(400).json({ success: false, message: "Inspection and installation times must use a valid 24-hour time." });
    }

    if (req.body.manual_override !== undefined && req.body.manual_override !== null && String(req.body.manual_override).trim() !== ""
      && (!Number.isFinite(Number(req.body.manual_override)) || Number(req.body.manual_override) < 0)) {
      return res.status(400).json({ success: false, message: "Manual price override must be a valid non-negative amount." });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "Order items are required" });
    }

    const installationDateError = getInstallationDateError(inspection_date, estimated_installation_date);
    if (installationDateError) {
      return res.status(400).json({ success: false, message: installationDateError });
    }

    if (!Number.isFinite(Number(inspection_duration_minutes)) || Number(inspection_duration_minutes) < 30 || !Number.isFinite(Number(inspection_travel_minutes)) || Number(inspection_travel_minutes) < 0 || !Number.isFinite(Number(installation_duration_minutes)) || Number(installation_duration_minutes) < 1) {
      return res.status(400).json({ success: false, message: "Inspection, travel, and installation durations must be valid non-negative minutes (inspection minimum is 30)." });
    }
    const scheduleError = await validateOrderSchedules({ inspection_date, inspection_time, inspection_duration_minutes, inspection_travel_minutes, estimated_installation_date, estimated_installation_time, installation_duration_minutes });
    if (scheduleError) return res.status(409).json({ success: false, code: "SCHEDULE_UNAVAILABLE", message: scheduleError });

    const requestedRushCharges = countSelectedRushItems(items);
    if (requestedRushCharges > 2) {
      return res.status(400).json({ success: false, code: "RUSH_CHARGE_ORDER_LIMIT", message: "An order can include a maximum of 2 Rush charges." });
    }
    const requestedRushOrders = requestedRushCharges > 0 ? 1 : 0;
    if (requestedRushOrders > 0 && !inspection_date) {
      return res.status(400).json({ success: false, message: "A scheduled inspection date is required for a Rush Order." });
    }
    if (requestedRushOrders > 0) {
      const rushOrderCount = await countRushOrdersOnDate(inspection_date);
      if (rushOrderCount + requestedRushOrders > RUSH_ORDER_DAILY_LIMIT) {
        const requestedTotal = rushOrderCount + requestedRushOrders;
        return res.status(409).json({
          success: false,
          code: "RUSH_ORDER_DAILY_LIMIT",
          message: `This order would use ${requestedTotal} Rush Order slots on the selected date. The daily maximum is ${RUSH_ORDER_DAILY_LIMIT}.`,
          rush_order_count: rushOrderCount,
          requested_rush_order_count: requestedRushOrders,
          rush_order_limit: RUSH_ORDER_DAILY_LIMIT,
        });
      }
    }

    const normalizedOrderType = order_type === "walk_in_customer" ? "walk_in_customer" : "online_order";
    const isWalkInCustomer = normalizedOrderType === "walk_in_customer";

    if (customer_id && !mongoose.Types.ObjectId.isValid(customer_id)) {
      return res.status(400).json({ success: false, message: "Customer account ID is invalid" });
    }

    const linkedCustomer = customer_id
      ? await User.findOne({ _id: customer_id, role: "customer" }).select("first_name last_name email phone street_address city province zip_code")
      : null;

    if (customer_id && !linkedCustomer) {
      return res.status(400).json({ success: false, message: "The selected customer account was not found" });
    }

    const normalizedShippingAddress = normalizeAddress(shipping_address || buildAddressFromUser(linkedCustomer));
    const shippingAddressError = getStreetAddressError(normalizedShippingAddress);
    if (shippingAddressError) return res.status(400).json({ success: false, message: shippingAddressError });

    const repricedItems = await repriceInspectionItems(items);
    const normalizedProjectCharges = normalizeProjectCharges(project_additional_charges);
    if (normalizedProjectCharges.error) return res.status(400).json({ success: false, message: normalizedProjectCharges.error });
    const pricedItems = repricedItems.map((item) => ({
      ...item,
      warranty_start_date: null,
      warranty_expiry_date: null,
      warranty_status: item.warranty_period === "No Warranty" ? "no_warranty" : "pending",
    }));
    const calculatedEstimatedCost = pricedItems.reduce((sum, item) => sum + getItemAmountValue(item), 0);
    if (!(calculatedEstimatedCost > 0)) {
      return res.status(400).json({ success: false, message: "Inspection items must have valid configured prices." });
    }
    const estimated_cost = calculatedEstimatedCost + normalizedProjectCharges.charges.reduce((sum, charge) => sum + charge.amount, 0);
    const manualOverride = Math.max(Number(req.body.manual_override) || 0, 0);
    const total_amount = manualOverride || estimated_cost;
    const requiredAmount = calculateRequiredDownpayment(total_amount, payment_terms, required_downpayment_amount);
    const initialPaidAmount = downpayment_received ? requiredAmount : 0;

    const hasWebsiteAccount = Boolean(linkedCustomer);
    const hasSignedWalkInContract = isWalkInCustomer && Boolean(signed_contract_url);
    const walkInSignedAt = hasSignedWalkInContract
      ? contract_signed_date ? new Date(contract_signed_date) : new Date()
      : null;
    const linkedCustomerName = `${linkedCustomer?.first_name || ""} ${linkedCustomer?.last_name || ""}`.trim();

    const order = new Order({
      customer: linkedCustomer?._id,
      customer_name: linkedCustomerName || customer_name || "",
      customer_phone: linkedCustomer?.phone || customer_phone || "",
      customer_email: linkedCustomer?.email || customer_email || "",
      items: pricedItems,
      total_amount,
      estimated_cost,
      project_additional_charges: normalizedProjectCharges.charges,
      final_project_cost: total_amount,
      manual_override: manualOverride,
      contract_amount: isWalkInCustomer ? total_amount : 0,
      downpayment_amount: requiredAmount,
      required_downpayment_amount: requiredAmount,
      amount_paid: initialPaidAmount,
      shipping_address: normalizedShippingAddress,
      payment_terms: payment_terms || "",
      agreed_payment_date: agreed_payment_date ? new Date(agreed_payment_date) : null,
      has_account_on_website: hasWebsiteAccount,
      downpayment_received: initialPaidAmount >= requiredAmount && requiredAmount > 0,
      warranty_period: warranty_period !== undefined && warranty_period !== null && String(warranty_period).trim() !== ""
        ? String(warranty_period)
        : "90",
      warranty_assignment_mode: warranty_assignment_mode === "per_product" ? "per_product" : "same",
      custom_warranty_days: custom_warranty_days !== undefined && custom_warranty_days !== null && Number(custom_warranty_days) > 0
        ? Number(custom_warranty_days)
        : null,
      attachments: Array.isArray(attachments) ? attachments : [],
      tracking: generateTrackingNumber(),
      order_type: normalizedOrderType,
      contract_status: hasSignedWalkInContract ? "accepted" : "pending",
      payment_status: "pending",
      status: hasSignedWalkInContract ? "contract_accepted" : "site_inspection",
      inspection_status: hasSignedWalkInContract ? "completed" : inspection_date ? "scheduled" : "pending",
      inspection_completed_at: hasSignedWalkInContract ? walkInSignedAt : null,
      inspection_date: inspection_date ? new Date(inspection_date) : null,
      inspection_time: inspection_time || "",
      inspection_duration_minutes: Number(inspection_duration_minutes),
      inspection_travel_minutes: Number(inspection_travel_minutes),
      is_rush_order: is_rush_order === true,
      estimated_installation_date: estimated_installation_date ? new Date(estimated_installation_date) : null,
      estimated_installation_time: estimated_installation_time || "",
      installation_duration_minutes: Number(installation_duration_minutes),
      inspection_notes: inspection_notes || "",
      // Walk-in specific
      acceptance_method: hasSignedWalkInContract ? "walk_in_signed_contract" : isWalkInCustomer ? "walk_in_pending_contract" : "online",
      acceptanceMethod: hasSignedWalkInContract ? "Walk-in Signed Contract" : isWalkInCustomer ? "Walk-in Pending Contract" : "Online",
      acceptedByCustomer: false,
      acceptedAt: null,
      transactionCreated: hasSignedWalkInContract,
      transactionCreatedAt: hasSignedWalkInContract ? new Date() : null,
      signed_contract_url: isWalkInCustomer ? (signed_contract_url || "") : "",
      contract_number: isWalkInCustomer ? (contract_number || "") : "",
      contract_signed_date: hasSignedWalkInContract ? walkInSignedAt : null,
      contractStatus: hasSignedWalkInContract ? "Accepted" : "Not Generated",
      contractGenerated: hasSignedWalkInContract,
      contractId: hasSignedWalkInContract ? (contract_number || "") : "",
      contractVersion: hasSignedWalkInContract ? 1 : 0,
      currentContractVersion: hasSignedWalkInContract ? 1 : 0,
      contractGeneratedAt: hasSignedWalkInContract ? walkInSignedAt : null,
      contractHistory: hasSignedWalkInContract ? [{
        version: 1,
        contractId: contract_number || "",
        generatedAt: walkInSignedAt,
        status: "Accepted",
        acceptedAt: walkInSignedAt,
        acceptanceMethod: "Walk-in Signed Contract",
      }] : [],
    });

    order.payment_status = getOrderPaymentStatus(order);
    await saveWithScheduleReservations(order, {
      inspection_date, inspection_time, inspection_duration_minutes, inspection_travel_minutes,
      estimated_installation_date, estimated_installation_time, installation_duration_minutes,
    }, () => order.save());

    res.status(201).json({ success: true, order });
    void sendOrderNotification(hasSignedWalkInContract ? "contract_accepted" : "order_submitted", order);
  } catch (error) {
    console.error("Create order as admin error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || "Unable to create order" });
  }
};

export const trackOrder = async (req, res) => {
  try {
    const tracking = req.params.tracking?.trim().toUpperCase();
    if (!tracking) {
      return res.status(400).json({ success: false, message: "Tracking number is required" });
    }

    const orderQuery = mongoose.Types.ObjectId.isValid(tracking)
      ? { $or: [{ tracking }, { _id: tracking }] }
      : { tracking };
    const order = await Order.findOne(orderQuery)
      .populate("customer", "first_name last_name email phone street_address city province zip_code")
      .populate("items.product_id", "image_url image images name product_name category product_type unit unit_price price_per_sqft price_per_blade area_options width height measurement_unit standard_size finished_door_pricing");
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (req.query.itemIndex !== undefined) {
      const itemIndex = Number(req.query.itemIndex);
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
        return res.status(400).json({ success: false, message: "A valid product index is required." });
      }
      if (!order.items[itemIndex]?.review?.submittedAt) {
        return res.status(404).json({ success: false, message: "Product feedback not found." });
      }

      order.items[itemIndex].review = null;
      order.markModified(`items.${itemIndex}.review`);
      await order.save();
      return res.json({ success: true, order });
    }


    if (req.user && !["admin", "super_admin"].includes(req.user.role) && order.customer._id.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to view this order" });
    }

    const responseOrder = order.toObject();
    if (!req.user || !["admin", "super_admin", "skilled_worker"].includes(req.user.role)) {
      delete responseOrder.progress_notes;
      delete responseOrder.progress_audit;
      delete responseOrder.protected_project_notes;
      delete responseOrder.progress_activity_notes;
      (responseOrder.items || []).forEach((item) => {
        delete item.progress_notes;
        delete item.progress_audit;
        delete item.protected_project_notes;
        delete item.progress_activity_notes;
      });
    }
    res.json({ success: true, order: attachOrderScheduleOverdue(responseOrder) });
  } catch (error) {
    console.error("Track order error:", error);
    res.status(500).json({ success: false, message: "Unable to track order", error: error.message });
  }
};

const redactStaffPaymentAmounts = (value) => {
  if (Array.isArray(value)) return value.map(redactStaffPaymentAmounts);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(amount|price|cost|balance|charge|subtotal|total|rate)/i.test(key)) output[key] = null;
    else output[key] = redactStaffPaymentAmounts(item);
  }
  return output;
};

const sanitizeStaffContractAccess = (value, staffAccess, moduleKey) => {
  if (Array.isArray(value)) return value.map((item) => sanitizeStaffContractAccess(item, staffAccess, moduleKey));
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const moduleAccess = staffAccess?.modules?.[moduleKey];
  const canViewContract = moduleAccess?.enabled === true && moduleAccess.actions?.view_contract === true;
  const canDownloadContract = moduleAccess?.enabled === true && moduleAccess.actions?.download_contract === true;
  const contractFields = new Set(["contractId", "contractVersion", "currentContractVersion", "contractGeneratedAt", "contractGenerated", "contractNeedsRegeneration", "contractSentAt", "contract_email_status", "contract_email_error", "contractDeclineReason", "contractDeclinedAt", "contract_number", "contract_signed_date", "contract_terms", "contract_snapshot"]);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if ((!canViewContract && contractFields.has(key)) || ((key === "signed_contract_url" || /contract.*(url|download)/i.test(key)) && !canDownloadContract)) continue;
    output[key] = sanitizeStaffContractAccess(item, staffAccess, moduleKey);
  }
  return output;
};

export const getAdminOrders = async (req, res) => {
  try {
    if (!["admin", "super_admin", "skilled_worker"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Staff access required" });
    }

    const { status, contract_status, payment_proof_submitted, search, module, view } = req.query;
    const filter = {};
    const parseCsv = (value) => String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    const statusValues = parseCsv(status);
    const contractStatusValues = parseCsv(contract_status);
    if (statusValues.length === 1) filter.status = statusValues[0];
    if (statusValues.length > 1) filter.status = { $in: statusValues };
    if (contractStatusValues.length === 1) filter.contract_status = contractStatusValues[0];
    if (contractStatusValues.length > 1) filter.contract_status = { $in: contractStatusValues };
    if (payment_proof_submitted === "true") {
      filter.payment_proof_submitted_at = { $exists: true, $ne: null };
    }
    if (status === "site_inspection" && !contract_status) {
      filter.$or = [
        { contract_status: { $in: ["pending", "sent", "declined", ""] } },
        { contract_status: { $exists: false } },
        { contract_status: null },
      ];
    }
    if (search) {
      const safeSearch = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (safeSearch) {
        const searchRegex = new RegExp(safeSearch, "i");
        filter.$and = [
          ...(filter.$and || []),
          {
            $or: [
              { tracking: searchRegex },
              { customer_name: searchRegex },
              { customer_email: searchRegex },
              { customer_phone: searchRegex },
            ],
          },
        ];
      }
    }

    const limitValue = Math.min(Math.max(Number(req.query.limit) || 0, 0), 500);
    const pageValue = Math.max(Number(req.query.page) || 1, 1);
    const skipValue = limitValue ? (pageValue - 1) * limitValue : 0;
    const baseFields = [
      "customer customer_name customer_email customer_phone has_account_on_website shipping_address items project_additional_charges total_amount estimated_cost final_project_cost manual_override installation_extra_charge_total installation_extra_charge_paid_total",
      "payment_terms downpayment_amount required_downpayment_amount amount_paid payment_status payment_records payment_proof_amount payment_proof_submitted_at payment_proof_confirmed_at payment_proof_file_name payment_proof_file_url payment_method transaction_number",
      "status cancellation_reason customer_cancellation_count_at_cancel is_rush_order order_type contract_status contractStatus contractGenerated contractId contractVersion currentContractVersion contractGeneratedAt contractNeedsRegeneration contractSentAt contract_email_status contract_email_error contractDeclineReason contractDeclinedAt acceptedByCustomer acceptedAt acceptanceMethod transactionCreated transactionCreatedAt transaction_approved",
      "tracking inspection_status inspection_completed_at inspection_date inspection_time inspection_duration_minutes inspection_travel_minutes estimated_installation_date estimated_installation_time installation_duration_minutes inspection_notes issues_found",
      "progress progress_stages progress_notes progress_audit protected_project_notes progress_activity_notes project_delay attachments warranty_assignment_mode warranty_period custom_warranty_days warranty_start_date warranty_expiry_date warranty_status warranty_terms price_change_history review signed_contract_url contract_number contract_signed_date acceptance_method createdAt updatedAt",
    ].join(" ");
    const moduleFields = {
      dashboard: [
        "customer customer_name customer_email customer_phone items total_amount estimated_cost final_project_cost manual_override installation_extra_charge_total installation_extra_charge_paid_total",
        "status is_rush_order contract_status contractStatus contractSentAt contractDeclineReason acceptedByCustomer acceptedAt transactionCreated tracking createdAt updatedAt",
      ].join(" "),
      notifications: [
        "customer customer_name customer_email customer_phone items total_amount final_project_cost installation_extra_charge_total installation_extra_charge_paid_total",
        "status cancellation_reason customer_cancellation_count_at_cancel order_type contract_status contractStatus contractSentAt payment_status payment_records payment_proof_amount payment_proof_submitted_at tracking inspection_status inspection_date inspection_time estimated_installation_date estimated_installation_time createdAt updatedAt",
      ].join(" "),
      transactions: [
        "customer customer_name customer_email customer_phone shipping_address has_account_on_website items project_additional_charges total_amount estimated_cost final_project_cost manual_override installation_extra_charge_total installation_extra_charge_paid_total",
        "payment_terms downpayment_amount required_downpayment_amount amount_paid payment_status payment_records payment_proof_amount payment_proof_submitted_at payment_proof_confirmed_at payment_proof_file_name payment_proof_file_url payment_method transaction_number",
        "inspection_status inspection_completed_at inspection_date inspection_time",
        "status cancellation_reason cancellation_date cancellation_previous_status cancelled_by cancelled_by_name order_type contract_status contractStatus contractGenerated contractId contractVersion currentContractVersion contractGeneratedAt contractNeedsRegeneration contractSentAt contract_email_status contract_email_error contractDeclineReason contractDeclinedAt acceptedByCustomer acceptedAt acceptanceMethod acceptance_method transactionCreated transactionCreatedAt transaction_approved tracking warranty_period warranty_status estimated_installation_date estimated_installation_time installation_duration_minutes progress progress_stages signed_contract_url contract_number contract_signed_date createdAt updatedAt",
      ].join(" "),
      site_inspection: [
        "customer customer_name customer_email customer_phone items project_additional_charges total_amount estimated_cost final_project_cost manual_override installation_extra_charge_total installation_extra_charge_paid_total",
        "status cancellation_reason cancellation_date cancellation_previous_status cancelled_by cancelled_by_name order_type contract_status contractStatus contractGenerated contractId contractVersion currentContractVersion contractGeneratedAt contractNeedsRegeneration contractSentAt contract_email_status contractDeclineReason acceptedByCustomer acceptedAt transactionCreated tracking",
        "inspection_status inspection_completed_at inspection_date inspection_time inspection_duration_minutes inspection_travel_minutes estimated_installation_date estimated_installation_time installation_duration_minutes inspection_notes issues_found shipping_address warranty_period warranty_status createdAt updatedAt",
      ].join(" "),
      progress_monitoring: [
        "customer customer_name customer_email customer_phone items status cancellation_reason cancellation_date cancellation_previous_status cancelled_by cancelled_by_name contract_status acceptance_method acceptanceMethod acceptedByCustomer order_type signed_contract_url contract_signed_date tracking progress progress_stages progress_notes progress_audit progress_activity_notes project_delay attachments",
        "estimated_installation_date estimated_installation_time installation_duration_minutes inspection_date inspection_time inspection_duration_minutes inspection_travel_minutes createdAt updatedAt",
      ].join(" "),
    };
    const selectedFields = req.user.role === "skilled_worker"
      ? moduleFields[req.staffAccessModule] || "_id"
      : moduleFields[view || module] || baseFields;

    const query = Order.find(filter)
      .select(selectedFields)
      .populate("items.product_id", "image_url image images name category product_type width height measurement_unit standard_size finished_door_pricing")
      .populate("customer", "first_name last_name email phone street_address city province zip_code customer_cancellation_count online_order_cooldown_until")
      .sort({ createdAt: -1 })
      .lean();

    if (skipValue) query.skip(skipValue);
    if (limitValue) query.limit(limitValue);

    const [orders, total] = await Promise.all([
      query,
      limitValue ? Order.countDocuments(filter) : Promise.resolve(undefined),
    ]);

    orders.forEach(attachOrderScheduleOverdue);
    let responseOrders = req.user.role === "skilled_worker"
      ? orders.map((order) => {
        const contractSafeOrder = sanitizeStaffContractAccess(order, req.staffAccess, req.staffAccessModule);
        return req.staffAccess?.hide_payment_amounts === true ? redactStaffPaymentAmounts(contractSafeOrder) : contractSafeOrder;
      })
      : orders;

    if (req.user.role !== "skilled_worker" && (view || module) === "transactions" && orders.length) {
      const orderIds = orders.map((order) => order._id);
      const [receipts, charges, projectReceipts] = await Promise.all([
        ExtraChargeReceipt.find({ order: { $in: orderIds } }).sort({ issued_at: -1 }).lean(),
        ExtraCharge.find({ order: { $in: orderIds }, status: { $in: ["Approved", "Receipt Generated"] } }).select("order total receipt payments approved_by_name approved_at").lean(),
        ProjectPaymentReceipt.find({ order: { $in: orderIds } }).sort({ issued_at: -1 }).lean(),
      ]);
      const chargeByReceipt = new Map();
      const chargeTotalsByOrder = new Map();
      const chargePaymentsByOrder = new Map();
      for (const charge of charges) {
        const orderKey = String(charge.order);
        const currentTotal = chargeTotalsByOrder.get(orderKey) || 0;
        chargeTotalsByOrder.set(orderKey, Math.round((currentTotal + Math.max(Number(charge.total) || 0, 0)) * 100) / 100);
        const verifiedChargePayments = (charge.payments || []).reduce((sum, payment) => (
          payment.status === "verified" ? sum + Math.max(Number(payment.amount) || 0, 0) : sum
        ), 0);
        const currentPaid = chargePaymentsByOrder.get(orderKey) || 0;
        chargePaymentsByOrder.set(orderKey, Math.round((currentPaid + verifiedChargePayments) * 100) / 100);
        if (charge.receipt) chargeByReceipt.set(String(charge.receipt), charge);
      }
      const receiptsByOrder = new Map();
      for (const receipt of receipts) {
        const orderKey = String(receipt.order);
        const group = receiptsByOrder.get(orderKey) || [];
        const charge = chargeByReceipt.get(String(receipt._id));
        group.push({
          ...receipt,
          payments: charge?.payments || [],
          approved_by_name: charge?.approved_by_name || "",
          approved_at: charge?.approved_at || null,
        });
        receiptsByOrder.set(orderKey, group);
      }
      const projectReceiptsByOrder = new Map();
      for (const receipt of projectReceipts) {
        const orderKey = String(receipt.order);
        const group = projectReceiptsByOrder.get(orderKey) || [];
        group.push(receipt);
        projectReceiptsByOrder.set(orderKey, group);
      }
      responseOrders = orders.map((order) => ({
        ...order,
        // Keep the running balance incremented by Save draft. Charge records
        // fill older missing totals without replacing a larger saved balance.
        installation_extra_charge_total: Math.max(
          Number(order.installation_extra_charge_total) || 0,
          chargeTotalsByOrder.get(String(order._id)) || 0,
        ),
        installation_extra_charge_paid_total: Math.max(
          Number(order.installation_extra_charge_paid_total) || 0,
          chargePaymentsByOrder.get(String(order._id)) || 0,
        ),
        extra_charge_receipts: receiptsByOrder.get(String(order._id)) || [],
        project_payment_receipts: projectReceiptsByOrder.get(String(order._id)) || [],
      }));
    }

    res.json({
      success: true,
      orders: responseOrders,
      pagination: limitValue
        ? { page: pageValue, limit: limitValue, total, totalPages: Math.max(1, Math.ceil(total / limitValue)) }
        : undefined,
    });
  } catch (error) {
    console.error("Get admin orders error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch orders", error: error.message });
  }
};

export const getAdminOrderById = async (req, res) => {
  try {
    if (!["admin", "super_admin", "skilled_worker"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Staff access required" });
    }

    const { orderId } = req.params;
    const isStaff = req.user.role === "skilled_worker";
    const detailModule = req.staffAccessModule;
    const staffFields = {
      dashboard: "customer customer_name customer_email customer_phone items status is_rush_order contract_status contractStatus contractSentAt contractDeclineReason acceptedByCustomer acceptedAt transactionCreated tracking createdAt updatedAt",
      site_inspection: "customer customer_name customer_email customer_phone items status contract_status contractStatus tracking inspection_status inspection_completed_at inspection_date inspection_time inspection_duration_minutes inspection_travel_minutes estimated_installation_date estimated_installation_time installation_duration_minutes inspection_notes issues_found shipping_address warranty_period warranty_status createdAt updatedAt",
      transactions: "customer customer_name customer_email customer_phone items project_additional_charges total_amount estimated_cost final_project_cost manual_override installation_extra_charge_total installation_extra_charge_paid_total payment_terms downpayment_amount required_downpayment_amount amount_paid payment_status payment_records payment_proof_amount payment_proof_submitted_at payment_proof_confirmed_at payment_proof_file_name payment_proof_file_url payment_method transaction_number inspection_status inspection_completed_at inspection_date inspection_time status cancellation_reason cancellation_date cancellation_previous_status cancelled_by cancelled_by_name contract_status contractStatus contractGenerated contractId contractVersion currentContractVersion contractGeneratedAt contractNeedsRegeneration contractSentAt contract_email_status contractDeclineReason acceptedByCustomer acceptedAt transactionCreated tracking warranty_period warranty_status estimated_installation_date estimated_installation_time installation_duration_minutes progress progress_stages createdAt updatedAt",
      progress_monitoring: "customer customer_name customer_email customer_phone items status cancellation_reason cancellation_date cancellation_previous_status cancelled_by cancelled_by_name contract_status acceptance_method acceptanceMethod acceptedByCustomer order_type signed_contract_url contract_signed_date tracking progress progress_stages progress_notes progress_audit progress_activity_notes project_delay attachments estimated_installation_date estimated_installation_time installation_duration_minutes createdAt updatedAt",
    };
    if (isStaff && !staffFields[detailModule]) return res.status(403).json({ success: false, message: "This staff module or action is disabled for your account." });
    const orderQuery = Order.findById(orderId);
    if (isStaff) orderQuery.select(staffFields[detailModule]);
    const order = await orderQuery
      .populate("customer", "first_name last_name email phone street_address city province zip_code customer_cancellation_count online_order_cooldown_until")
      .populate("items.product_id", "image_url image images name category product_type width height measurement_unit standard_size finished_door_pricing");

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const responseOrder = attachOrderScheduleOverdue(order);
    const contractSafeOrder = isStaff ? sanitizeStaffContractAccess(responseOrder.toObject?.() || responseOrder, req.staffAccess, detailModule) : responseOrder;
    res.json({ success: true, order: isStaff && req.staffAccess?.hide_payment_amounts === true ? redactStaffPaymentAmounts(contractSafeOrder) : contractSafeOrder });
  } catch (error) {
    console.error("Get admin order error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch order", error: error.message });
  }
};

export const cancelAdminOrder = async (req, res) => {
  try {
    const reason = String(req.body?.reason || req.body?.cancellation_reason || "").trim();
    if (!reason) return res.status(400).json({ success: false, message: "A cancellation reason is required." });
    if (reason.length > 1000) return res.status(400).json({ success: false, message: "Cancellation reason must be 1,000 characters or fewer." });

    const orderId = req.params.orderId;
    const order = await Order.findById(orderId).populate("customer", "first_name last_name email");
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    const currentStatus = String(order.status || "").toLowerCase();
    if (currentStatus === "cancelled") return res.status(409).json({ success: false, message: "This project has already been cancelled." });

    const batchItems = Array.isArray(order.items) ? order.items : [];
    const allBatchItemsCompleted = batchItems.length > 0 && batchItems.every((item) => {
      const stages = Array.isArray(item?.progress_stages) ? item.progress_stages : [];
      return stages.length > 0
        ? stages.every((stage) => stage.completed === true || ["done", "completed"].includes(String(stage.status || "").toLowerCase()))
        : Number(item?.progress) >= 100;
    });
    const orderStages = Array.isArray(order.progress_stages) ? order.progress_stages : [];
    const allOrderStagesCompleted = orderStages.length > 0 && orderStages.every((stage) => (
      stage.completed === true
      || ["done", "completed"].includes(String(stage.status || "").toLowerCase())
    ));
    if (currentStatus === "completed" || Number(order.progress || 0) >= 100 || allBatchItemsCompleted || allOrderStagesCompleted) {
      return res.status(409).json({ success: false, message: "Completed projects cannot be cancelled." });
    }

    const cancelledAt = new Date();
    const actorId = String(req.user.id || req.user._id || "");
    const actor = req.user.first_name || req.user.last_name || req.user.name
      ? req.user
      : await User.findById(actorId).select("first_name last_name name email").lean();
    const actorName = [actor?.first_name, actor?.last_name].filter(Boolean).join(" ").trim()
      || actor?.name
      || actor?.email
      || "Administrator";
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        __v: order.__v,
        status: order.status,
        $and: [
          { status: { $nin: ["cancelled", "completed"] } },
          { $or: [{ progress: { $lt: 100 } }, { progress: null }, { progress: { $exists: false } }] },
        ],
      },
      {
        $set: {
          status: "cancelled",
          cancellation_reason: reason,
          cancellation_date: cancelledAt,
          cancellation_previous_status: order.status || "unknown",
          cancelled_by: actorId,
          cancelled_by_name: actorName,
        },
        $push: {
          progress_audit: {
            $each: [{
              type: "project_cancelled",
              at: cancelledAt,
              by: actorId,
              byName: actorName,
              byRole: req.user.role,
              reason,
              previousStatus: order.status || "unknown",
            }],
            $slice: -500,
          },
        },
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true },
    );
    if (!updatedOrder) {
      const latest = await Order.findById(order._id).select("status progress").lean();
      if (latest?.status === "cancelled") return res.status(409).json({ success: false, message: "This project has already been cancelled." });
      if (latest?.status === "completed" || Number(latest?.progress || 0) >= 100) return res.status(409).json({ success: false, message: "Completed projects cannot be cancelled." });
      return res.status(409).json({ success: false, message: "This project changed while it was being cancelled. Refresh and try again." });
    }

    await ScheduleReservation.deleteMany({ orderId: updatedOrder._id });
    if (updatedOrder.customer?._id) {
      try {
        await CustomerNotification.updateOne(
          { order: updatedOrder._id, eventKey: "project_cancelled" },
          { $setOnInsert: {
            customer: updatedOrder.customer._id,
            order: updatedOrder._id,
            eventKey: "project_cancelled",
            type: "order_cancelled",
            title: "Project Cancelled",
            message: `Project ${updatedOrder.tracking || updatedOrder._id} was cancelled. Reason: ${reason}`,
            tracking: updatedOrder.tracking || "",
            stageKey: "project_cancelled",
            stageName: "Project Cancelled",
          } },
          { upsert: true },
        );
      } catch (notificationError) {
        console.error("Failed to create project cancellation notification:", notificationError);
      }
    }

    res.json({ success: true, order: updatedOrder });
    void sendOrderNotification("order_cancelled", updatedOrder, {
      customerEmail: updatedOrder.customer?.email || updatedOrder.customer_email,
      date: cancelledAt,
      reason,
    });
  } catch (error) {
    console.error("Admin project cancellation error:", error);
    return res.status(500).json({ success: false, message: "Unable to cancel this project." });
  }
};

export const updateOrderStatus = async (req, res) => {
  try {
    if (!["admin", "super_admin"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { orderId } = req.params;
    const {
      status,
      contract_status,
      items,
      payment_amount,
      amount_paid,
      downpayment_amount,
      required_downpayment_amount,
      payment_terms,
      payment_proof_amount,
      payment_proof_confirmed_at,
      payment_record_action,
      payment_method,
      transaction_number,
      inspection_notes,
      inspection_date,
      warranty_period,
      warranty_assignment_mode,
      warranty_terms,
      custom_warranty_days,
      signed_contract_url,
      acceptance_method,
      acceptanceMethod,
      contract_number,
      contract_signed_date,
      inspection_status,
      inspection_completed_at,
      acceptedByCustomer,
      acceptedAt,
      transactionCreated,
      transactionCreatedAt,
      transaction_approval_action,
    } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const requestedProjectStatus = String(status || "").toLowerCase();
    if (requestedProjectStatus === "cancelled" || requestedProjectStatus === "canceled") {
      return res.status(400).json({ success: false, message: "Use the authorized project cancellation action and provide a cancellation reason." });
    }
    if (String(order.status || "").toLowerCase() === "cancelled" && (
      status !== undefined
      || contract_status !== undefined
      || transaction_approval_action !== undefined
      || transactionCreated === true
      || acceptedByCustomer === true
    )) {
      return res.status(409).json({ success: false, message: "Cancelled projects cannot be reactivated or approved." });
    }

    if (amount_paid !== undefined || payment_amount !== undefined) {
      return res.status(400).json({ success: false, message: "Payments must be recorded through a verified payment record action." });
    }

    const changesDownpaymentTerms = downpayment_amount !== undefined
      || required_downpayment_amount !== undefined
      || payment_terms !== undefined;
    if (payment_record_action && changesDownpaymentTerms) {
      return res.status(400).json({ success: false, message: "Payment records cannot change the downpayment terms agreed upon in the contract." });
    }
    const hasAgreedContractTerms = order.acceptedByCustomer === true
      || String(order.contract_status || "").toLowerCase() === "accepted"
      || String(order.contract_status || "").toLowerCase() === "sent"
      || Boolean(order.contractGenerated || order.contractSentAt);
    if (hasAgreedContractTerms && changesDownpaymentTerms) {
      return res.status(409).json({ success: false, message: "Downpayment terms cannot be changed after the contract has been sent or accepted." });
    }

    const previousPaymentStatus = order.payment_status;
    const previousOrderStatus = String(order.status || "").toLowerCase();
    const previousPaidAmount = getOrderPaymentAmounts(order).paidAmount;
    const hadConfirmedPaymentProof = Boolean(order.payment_proof_confirmed_at);
    const previousContractStatus = String(order.contract_status || "").toLowerCase();
    const previousWarranty = JSON.stringify({
      period: order.warranty_period,
      start: order.warranty_start_date,
      end: order.warranty_expiry_date,
      status: order.warranty_status,
      items: (order.items || []).map((item) => [item.warranty_period, item.warranty_start_date, item.warranty_expiry_date, item.warranty_status]),
    });

    const transactionApprovalAction = String(transaction_approval_action?.action || transaction_approval_action || "").toLowerCase();
    if (transactionApprovalAction) {
      if (transactionApprovalAction !== "approve") {
        return res.status(400).json({ success: false, message: "Invalid transaction approval action." });
      }
      if (order.transaction_approved) {
        return res.json({ success: true, duplicate: true, order, message: "Transaction already approved." });
      }
      const contractAccepted = String(order.contract_status || "").toLowerCase() === "accepted";
      const validOnlineAcceptance = order.order_type !== "walk_in_customer"
        && contractAccepted
        && order.acceptance_method === "online"
        && order.acceptedByCustomer === true;
      const validWalkInAcceptance = order.order_type === "walk_in_customer"
        && contractAccepted
        && order.acceptance_method === "walk_in_signed_contract"
        && Boolean(order.signed_contract_url)
        && Boolean(order.contract_signed_date);
      if (!validOnlineAcceptance && !validWalkInAcceptance) {
        return res.status(400).json({ success: false, message: "A verified accepted contract is required before approving this transaction." });
      }
      const approvedAt = new Date();
      const acceptanceFilter = validWalkInAcceptance
        ? {
            acceptance_method: "walk_in_signed_contract",
            signed_contract_url: { $ne: "" },
            contract_signed_date: { $ne: null },
          }
        : { acceptance_method: "online", acceptedByCustomer: true };
      const approvedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: order.status,
          contract_status: "accepted",
          transaction_approved: { $ne: true },
          ...acceptanceFilter,
        },
        {
          $set: {
            transaction_approved: true,
            transaction_approved_at: approvedAt,
            transaction_approved_by: req.user.id,
            transactionCreated: true,
            transactionCreatedAt: order.transactionCreatedAt || approvedAt,
            status: "approved",
          },
        },
        { new: true, runValidators: true },
      );
      if (!approvedOrder) {
        const latestOrder = await Order.findById(order._id);
        if (latestOrder?.transaction_approved) {
          return res.json({ success: true, duplicate: true, order: latestOrder, message: "Transaction already approved." });
        }
        return res.status(409).json({ success: false, message: "The contract changed while this transaction was being approved. Refresh and review the latest record." });
      }
      res.json({ success: true, order: approvedOrder });
      void sendOrderNotification("transaction_approved", approvedOrder, {
        customerEmail: approvedOrder.customer_email || approvedOrder.customer?.email,
        approvedAt,
      });
      return;
    }

    const requestedStatus = String(status || order.status || "").toLowerCase();
    const requestedContractStatus = String(contract_status || order.contract_status || "").toLowerCase();
    const requestsTransactionEntry =
      requestedStatus === "contract_accepted" ||
      requestedContractStatus === "accepted" ||
      transactionCreated === true;

    if (requestsTransactionEntry) {
      const requestedAcceptanceMethod = acceptance_method || order.acceptance_method;
      const isVerifiedWalkInContract =
        order.order_type === "walk_in_customer" &&
        requestedStatus === "contract_accepted" &&
        requestedContractStatus === "accepted" &&
        requestedAcceptanceMethod === "walk_in_signed_contract" &&
        Boolean(signed_contract_url || order.signed_contract_url) &&
        Boolean(contract_signed_date || order.contract_signed_date);
      const isCustomerAcceptedOnlineContract =
        order.order_type !== "walk_in_customer" &&
        order.acceptedByCustomer === true &&
        requestedAcceptanceMethod === "online" &&
        String(order.contract_status || "").toLowerCase() === "accepted";

      if (!isVerifiedWalkInContract && !isCustomerAcceptedOnlineContract) {
        return res.status(400).json({
          success: false,
          message: "Customer acceptance is required before this order can enter Transactions.",
        });
      }
    }

    let paymentActionResult = null;
    if (payment_record_action) {
      initializePaymentLedger(order);
      const action = String(payment_record_action.action || "").toLowerCase();
      const record = payment_record_action.record_id
        ? order.payment_records.id(payment_record_action.record_id)
        : order.payment_records.find((entry) => entry.status === "pending");

      if (action === "review_discrepancy" || action === "resolve_discrepancy") {
        const discrepancy = record?.discrepancies.id(payment_record_action.discrepancy_id);
        if (!record || !discrepancy) {
          return res.status(404).json({ success: false, message: "Payment discrepancy not found." });
        }
        if (discrepancy.status === "resolved") {
          return res.status(409).json({ success: false, message: "This payment discrepancy is already resolved." });
        }
        const note = String(payment_record_action.reason || "").trim();
        if (!note) return res.status(400).json({ success: false, message: "Provide a note before updating the discrepancy status." });
        if (note.length > 1000) return res.status(400).json({ success: false, message: "Discrepancy notes must be 1000 characters or fewer." });
        const nextStatus = action === "resolve_discrepancy" ? "resolved" : "under_review";
        if (discrepancy.status === nextStatus) {
          return res.json({ success: true, duplicate: true, order });
        }
        const changedAt = new Date();
        discrepancy.status = nextStatus;
        discrepancy.status_history.push({
          status: nextStatus,
          note,
          changed_at: changedAt,
          changed_by: req.user.id,
          changed_by_name: getPaymentDocumentDisplayName(req.user),
          changed_by_role: req.user.role,
        });
        if (nextStatus === "resolved") {
          discrepancy.resolution_note = note;
          discrepancy.resolved_at = changedAt;
          discrepancy.resolved_by = req.user.id;
          discrepancy.resolved_by_name = getPaymentDocumentDisplayName(req.user);
          discrepancy.resolved_by_role = req.user.role;
        }
        paymentActionResult = {
          action: nextStatus === "resolved" ? "discrepancy_resolved" : "discrepancy_reviewed",
          recordId: record._id,
          discrepancyId: discrepancy._id,
          note,
          customerReportedAmount: discrepancy.customer_reported_amount,
          adminRecordedAmount: discrepancy.admin_recorded_amount,
          difference: discrepancy.difference,
        };
      } else if (action === "request_downpayment_exception") {
        if (!record || record.status !== "pending") {
          return res.status(409).json({ success: false, message: "A customer payment awaiting verification is required to request an exception." });
        }
        if (record.downpayment_exception?.status === "pending") {
          return res.json({ success: true, duplicate: true, order });
        }
        if (record.downpayment_exception?.status === "approved") {
          return res.status(409).json({ success: false, message: "This payment already has an approved downpayment exception." });
        }
        const exceptionSummary = getDownpaymentExceptionSummary(order, record.submitted_amount);
        if (!exceptionSummary.eligible) {
          return res.status(409).json({ success: false, message: "The verified amount does not qualify for a downpayment exception." });
        }
        record.downpayment_exception = {
          status: "pending",
          accepted_amount: exceptionSummary.acceptedAmount,
          required_amount: exceptionSummary.requiredAmount,
          shortfall: exceptionSummary.shortfall,
          total_paid_at_approval: exceptionSummary.totalPaidAtApproval,
          requested_at: new Date(),
          requested_by: req.user.id,
        };
        paymentActionResult = { action: "exception_request", recordId: record._id, ...exceptionSummary };
      } else if (action === "verify" || action === "reject" || action === "adjust" || action === "accept_downpayment_exception") {
        const expectedRecordStatus = action === "adjust" ? "verified" : "pending";
        if (!record || record.status !== expectedRecordStatus) {
          return res.status(409).json({ success: false, message: "This payment is no longer awaiting verification." });
        }
        if (action === "accept_downpayment_exception" && record.downpayment_exception?.status === "approved") {
          return res.status(409).json({ success: false, message: "This payment already has an approved downpayment exception." });
        }
        const reason = String(payment_record_action.reason || "").trim();
        if (action === "reject") {
          if (!reason) return res.status(400).json({ success: false, message: "Provide a reason for rejecting this payment proof." });
          record.status = "rejected";
          record.rejected_at = new Date();
          record.verified_by = req.user.id;
          record.admin_reason = reason;
          if (record.downpayment_exception?.status === "pending") {
            record.downpayment_exception.status = "rejected";
            record.downpayment_exception.reason = reason;
          }
          paymentActionResult = { action, recordId: record._id, submittedAmount: record.submitted_amount, reason };
          order.payment_proof_confirmed_at = null;
        } else {
          const oldVerifiedAmount = Number(record.verified_amount) || 0;
          const submittedAmount = action === "adjust" ? oldVerifiedAmount : Number(record.submitted_amount) || 0;
          const allowedRemainingAmount = getOrderPaymentAmounts(order).remainingAmount + (action === "adjust" ? oldVerifiedAmount : 0);
          const validation = validatePaymentAmount(
            action === "accept_downpayment_exception"
              ? payment_record_action.verified_amount ?? record.submitted_amount
              : payment_record_action.verified_amount,
            allowedRemainingAmount,
          );
          if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
          const verifiedAmount = validation.amount;
          const explicitlyAcceptedException = action === "accept_downpayment_exception"
            || payment_record_action.accept_downpayment_exception === true;
          const sellerApprovalParty = String(payment_record_action.seller_approval_party || "").trim();
          const exceptionApproval = validateDownpaymentExceptionApproval({
            explicitlyAccepted: explicitlyAcceptedException,
            sellerApprovalConfirmed: payment_record_action.seller_approval_confirmed === true,
            sellerApprovalParty,
            reason,
          });
          if (!exceptionApproval.valid) {
            return res.status(400).json({ success: false, message: exceptionApproval.message });
          }
          const exceptionValidation = validateDownpaymentExceptionAcceptance(
            order,
            verifiedAmount,
            action === "adjust" ? oldVerifiedAmount : 0,
            explicitlyAcceptedException,
          );
          if (!exceptionValidation.valid) {
            return res.status(409).json({ success: false, message: exceptionValidation.message });
          }
          const amountChanged = isPaymentDiscrepancy(submittedAmount, verifiedAmount);
          if (action === "adjust" && !amountChanged) {
            return res.status(400).json({ success: false, message: "The replacement amount must differ from the current verified amount." });
          }
          if ((amountChanged || action === "adjust") && !reason) {
            return res.status(400).json({ success: false, message: "Provide a reason when the verified amount differs from the customer's submitted amount." });
          }
          if (amountChanged || action === "adjust") {
            record.amount_history.push({
              previous_amount: submittedAmount,
              new_amount: verifiedAmount,
              reason,
              changed_at: new Date(),
              changed_by: req.user.id,
              changed_by_name: getPaymentDocumentDisplayName(req.user),
              changed_by_role: req.user.role,
            });
          }
          record.status = "verified";
          record.verified_amount = verifiedAmount;
          record.verified_at = new Date();
          record.verified_by = req.user.id;
          record.admin_reason = reason;
          if (record.submitted_amount != null && isPaymentDiscrepancy(record.submitted_amount, verifiedAmount)) {
            const latestDiscrepancy = record.discrepancies.at(-1);
            const duplicateDiscrepancy = latestDiscrepancy
              && latestDiscrepancy.status !== "resolved"
              && Math.round(Number(latestDiscrepancy.customer_reported_amount) * 100) === Math.round(Number(record.submitted_amount) * 100)
              && Math.round(Number(latestDiscrepancy.admin_recorded_amount) * 100) === Math.round(verifiedAmount * 100);
            if (!duplicateDiscrepancy) {
              const detectedAt = record.verified_at;
              record.discrepancies.push({
                customer_reported_amount: Number(record.submitted_amount),
                admin_recorded_amount: verifiedAmount,
                difference: Math.round(Math.abs(verifiedAmount - Number(record.submitted_amount)) * 100) / 100,
                status: "pending_review",
                reason,
                detected_at: detectedAt,
                detected_by: req.user.id,
                detected_by_name: getPaymentDocumentDisplayName(req.user),
                detected_by_role: req.user.role,
                status_history: [{
                  status: "pending_review",
                  note: reason,
                  changed_at: detectedAt,
                  changed_by: req.user.id,
                  changed_by_name: getPaymentDocumentDisplayName(req.user),
                  changed_by_role: req.user.role,
                }],
              });
            }
          }
          if (action === "verify" && record.downpayment_exception?.status === "pending") {
            record.downpayment_exception.status = "cancelled";
            record.downpayment_exception.reason = "Payment accepted through the normal partial-payment workflow.";
          }
          if (explicitlyAcceptedException) {
            const previousException = record.downpayment_exception || {};
            record.downpayment_exception = {
              status: "approved",
              accepted_amount: verifiedAmount,
              required_amount: exceptionValidation.summary.requiredAmount,
              shortfall: exceptionValidation.summary.shortfall,
              total_paid_at_approval: exceptionValidation.summary.totalPaidAtApproval,
              reason,
              seller_approval_party: sellerApprovalParty,
              seller_approval_confirmed_at: record.verified_at,
              seller_approval_confirmed_by: req.user.id,
              requested_at: previousException.requested_at || null,
              requested_by: previousException.requested_by || null,
              approved_at: record.verified_at,
              approved_by: req.user.id,
            };
          }
          order.payment_proof_amount = verifiedAmount;
          order.payment_proof_confirmed_at = record.verified_at;
          order.payment_method = record.payment_method || order.payment_method || "Cash";
          order.transaction_number = record.transaction_number || order.transaction_number || "";
          order.amount_paid = getOrderPaymentAmounts(order).paidAmount;
          paymentActionResult = {
            action: explicitlyAcceptedException ? "exception_approve" : action === "adjust" ? "adjust" : "verify",
            recordId: record._id,
            submittedAmount: action === "adjust" ? Number(record.submitted_amount) || oldVerifiedAmount : submittedAmount,
            previousAmount: submittedAmount,
            verifiedAmount,
            difference: Math.round((verifiedAmount - submittedAmount) * 100) / 100,
            amountChanged,
            wasAdjustment: action === "adjust",
            reason,
            exception: explicitlyAcceptedException ? exceptionValidation.summary : null,
          };
        }
        order.payment_proof_file_name = record.proof_file_name || order.payment_proof_file_name;
        order.payment_proof_file_url = record.proof_file_url || order.payment_proof_file_url;
      } else if (action === "record") {
        if (order.payment_records.some((entry) => entry.status === "pending")) {
          return res.status(409).json({ success: false, message: "Verify or reject the submitted proof before recording another payment." });
        }
        const requestId = String(payment_record_action.request_id || "").trim();
        if (!requestId || requestId.length > 100) {
          return res.status(400).json({ success: false, message: "A valid payment request ID is required." });
        }
        const priorRequest = order.payment_records.find((entry) => entry.request_id === requestId);
        if (priorRequest) return res.json({ success: true, duplicate: true, order });
        const reason = String(payment_record_action.reason || "").trim();
        if (reason.length > 1000) return res.status(400).json({ success: false, message: "Admin notes must be 1000 characters or fewer." });
        const paymentMethod = String(payment_record_action.payment_method || payment_method || "").trim();
        if (!paymentMethod || paymentMethod.length > 60) return res.status(400).json({ success: false, message: "Provide a valid payment method." });
        const paymentDate = new Date(payment_record_action.payment_date);
        if (!payment_record_action.payment_date || Number.isNaN(paymentDate.getTime()) || paymentDate > new Date()) {
          return res.status(400).json({ success: false, message: "Provide a valid payment date that is not in the future." });
        }
        const proofFileUrl = String(payment_record_action.proof_file_url || "").trim();
        const proofFileName = String(payment_record_action.proof_file_name || "").trim();
        if (proofFileName.length > 255) return res.status(400).json({ success: false, message: "The payment proof filename is too long." });
        if (proofFileUrl) {
          try {
            const uploadedProofUrl = new URL(proofFileUrl);
            if (uploadedProofUrl.hostname !== "res.cloudinary.com" || !uploadedProofUrl.pathname.includes("/acgc/payment-proofs/")) {
              return res.status(400).json({ success: false, message: "Upload proof using the supported payment-proof uploader." });
            }
          } catch {
            return res.status(400).json({ success: false, message: "Provide a valid uploaded proof URL." });
          }
        }
        const transactionNumber = String(payment_record_action.transaction_number || "").trim();
        if (transactionNumber.length > 120) return res.status(400).json({ success: false, message: "The payment reference number is too long." });
        if (paymentMethod.toLowerCase() !== "cash" && !proofFileUrl && !transactionNumber) {
          return res.status(400).json({ success: false, message: "Provide payment proof or a reference number for non-cash payments." });
        }
        const validation = validatePaymentAmount(
          payment_record_action.verified_amount,
          getOrderPaymentAmounts(order).remainingAmount,
        );
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
        const exceptionValidation = validateDownpaymentExceptionAcceptance(
          order,
          validation.amount,
          0,
          payment_record_action.accept_downpayment_exception === true,
        );
        if (!exceptionValidation.valid) {
          return res.status(409).json({ success: false, message: exceptionValidation.message });
        }
        const sellerApprovalParty = String(payment_record_action.seller_approval_party || "").trim();
        const exceptionApproval = validateDownpaymentExceptionApproval({
          explicitlyAccepted: payment_record_action.accept_downpayment_exception === true,
          sellerApprovalConfirmed: payment_record_action.seller_approval_confirmed === true,
          sellerApprovalParty,
          reason,
        });
        if (!exceptionApproval.valid) {
          return res.status(400).json({ success: false, message: exceptionApproval.message });
        }
        const verifiedAt = new Date();
        const downpaymentException = exceptionValidation.summary.eligible ? {
          status: "approved",
          accepted_amount: validation.amount,
          required_amount: exceptionValidation.summary.requiredAmount,
          shortfall: exceptionValidation.summary.shortfall,
          total_paid_at_approval: exceptionValidation.summary.totalPaidAtApproval,
          reason,
          seller_approval_party: sellerApprovalParty,
          seller_approval_confirmed_at: verifiedAt,
          seller_approval_confirmed_by: req.user.id,
          approved_at: verifiedAt,
          approved_by: req.user.id,
        } : null;
        const manualRecord = order.payment_records.create({
          request_id: requestId,
          record_source: "admin_recorded",
          submitted_amount: null,
          verified_amount: validation.amount,
          status: "verified",
          payment_method: paymentMethod,
          transaction_number: transactionNumber,
          proof_file_name: proofFileName,
          proof_file_url: proofFileUrl,
          submitted_at: paymentDate,
          payment_date: paymentDate,
          recorded_at: verifiedAt,
          recorded_by: req.user.id,
          verified_at: verifiedAt,
          verified_by: req.user.id,
          admin_reason: reason,
          downpayment_exception: downpaymentException,
        });
        order.payment_records.push(manualRecord);
        order.payment_method = manualRecord.payment_method;
        order.transaction_number = manualRecord.transaction_number;
        order.amount_paid = getOrderPaymentAmounts(order).paidAmount;
        paymentActionResult = {
          action,
          recordId: manualRecord._id,
          verifiedAmount: validation.amount,
          reason,
          exception: exceptionValidation.summary.eligible ? exceptionValidation.summary : null,
        };
      } else {
        return res.status(400).json({ success: false, message: "Invalid payment action." });
      }
    } else if (payment_proof_amount !== undefined || payment_proof_confirmed_at !== undefined) {
      return res.status(400).json({ success: false, message: "Payment proofs must be verified through a payment record action." });
    }

    const requestedPaidAmount = amount_paid ?? payment_amount;
    if (requestedPaidAmount !== undefined && !paymentActionResult) {
      const totalAmount = getOrderPaymentAmounts(order).totalAmount;
      if (Math.round(Number(requestedPaidAmount) * 100) > Math.round(totalAmount * 100)) {
        return res.status(400).json({ success: false, message: "Payment cannot exceed the project total." });
      }
    }

    if (status) order.status = status;
    if (String(status || "").toLowerCase() === "cancelled" && (req.body?.reason !== undefined || req.body?.cancellation_reason !== undefined)) {
      order.cancellation_reason = String(req.body.reason || req.body.cancellation_reason || "").trim();
    }
    if (contract_status) order.contract_status = contract_status;
    if (required_downpayment_amount !== undefined) {
      const nextRequiredAmount = Math.min(
        getOrderPaymentAmounts(order).totalAmount,
        Math.max(Number(required_downpayment_amount) || 0, 0),
      );
      order.required_downpayment_amount = nextRequiredAmount;
      order.downpayment_amount = nextRequiredAmount;
    } else if (downpayment_amount !== undefined && payment_amount === undefined && amount_paid === undefined) {
      const nextRequiredAmount = Math.min(
        getOrderPaymentAmounts(order).totalAmount,
        Math.max(Number(downpayment_amount) || 0, 0),
      );
      order.required_downpayment_amount = nextRequiredAmount;
      order.downpayment_amount = nextRequiredAmount;
    }
    if ((amount_paid !== undefined || payment_amount !== undefined) && !paymentActionResult) {
      const nextPaidAmount = Math.max(Number(requestedPaidAmount) || 0, 0);
      if (order.payment_ledger_initialized) {
        const verifiedRecordAmount = (order.payment_records || []).reduce((sum, record) => (
          record.status === "verified" ? sum + (Number(record.verified_amount) || 0) : sum
        ), 0);
        if (Math.round(nextPaidAmount * 100) < Math.round(verifiedRecordAmount * 100)) {
          return res.status(400).json({ success: false, message: "Total paid cannot be lower than the verified payment records." });
        }
        order.legacy_verified_amount = Math.max(0, nextPaidAmount - verifiedRecordAmount);
      } else {
        order.amount_paid = nextPaidAmount;
      }
    }
    if (payment_method !== undefined) order.payment_method = payment_method || order.payment_method || "Cash";
    if (transaction_number !== undefined) order.transaction_number = transaction_number || "";
    if (inspection_date) order.inspection_date = inspection_date;
    if (inspection_notes) order.inspection_notes = inspection_notes;
    if (warranty_period !== undefined) order.warranty_period = warranty_period !== null && String(warranty_period).trim() !== "" ? String(warranty_period) : "90";
    if (warranty_assignment_mode !== undefined) {
      order.warranty_assignment_mode = warranty_assignment_mode === "per_product" ? "per_product" : "same";
    }
    if (custom_warranty_days !== undefined) order.custom_warranty_days = Number(custom_warranty_days) > 0 ? Number(custom_warranty_days) : null;
    if (signed_contract_url !== undefined) order.signed_contract_url = signed_contract_url || "";
    if (acceptance_method !== undefined) order.acceptance_method = ["online", "walk_in_signed_contract"].includes(String(acceptance_method)) ? acceptance_method : order.acceptance_method;
    if (acceptanceMethod !== undefined) order.acceptanceMethod = acceptanceMethod;
    if (contract_number !== undefined) order.contract_number = contract_number || "";
    if (contract_signed_date !== undefined) order.contract_signed_date = contract_signed_date ? new Date(contract_signed_date) : null;
    if (inspection_status !== undefined) order.inspection_status = inspection_status;
    if (inspection_completed_at !== undefined) order.inspection_completed_at = inspection_completed_at ? new Date(inspection_completed_at) : null;
    if (acceptedByCustomer !== undefined) order.acceptedByCustomer = Boolean(acceptedByCustomer);
    if (acceptedAt !== undefined) order.acceptedAt = acceptedAt ? new Date(acceptedAt) : null;
    if (transactionCreated !== undefined) order.transactionCreated = Boolean(transactionCreated);
    if (transactionCreatedAt !== undefined) order.transactionCreatedAt = transactionCreatedAt ? new Date(transactionCreatedAt) : null;
    if (warranty_period !== undefined) order.warranty_period = warranty_period;
    if (warranty_terms !== undefined) order.warranty_terms = warranty_terms;
    if (Array.isArray(items)) {
      items.forEach((incomingItem, index) => {
        const item = order.items[index];
        if (!item) return;
        ["warranty_period", "custom_warranty_days"].forEach((field) => {
          if (incomingItem[field] !== undefined) item[field] = incomingItem[field];
        });
      });
      order.markModified("items");
    }

    const { requiredAmount, paidAmount } = getOrderPaymentAmounts(order);
    order.downpayment_received = requiredAmount > 0 && paidAmount >= requiredAmount;
    order.payment_status = getOrderPaymentStatus(order);

    await order.save();
    if (String(order.status || "").toLowerCase() === "cancelled" || String(order.status || "").toLowerCase() === "canceled") {
      await ScheduleReservation.deleteMany({ orderId: order._id });
    }

    res.json({ success: true, order });
    const currentPaidAmount = getOrderPaymentAmounts(order).paidAmount;
    const paymentProofJustConfirmed = Boolean(order.payment_proof_confirmed_at && !hadConfirmedPaymentProof);
    const confirmedPaymentAmount = Math.max(currentPaidAmount - previousPaidAmount, 0) || Number(order.payment_proof_amount) || 0;
    if (paymentActionResult?.action === "discrepancy_resolved") {
      void sendOrderNotification("payment_discrepancy_resolved", order, {
        customerEmail: order.customer_email || order.customer?.email,
        paymentRecordId: String(paymentActionResult.recordId),
        discrepancyId: String(paymentActionResult.discrepancyId),
        reason: paymentActionResult.note,
        customerReportedAmount: paymentActionResult.customerReportedAmount,
        adminRecordedAmount: paymentActionResult.adminRecordedAmount,
        difference: paymentActionResult.difference,
      });
    } else if (paymentActionResult?.action === "reject") {
      void sendOrderNotification("payment_proof_rejected", order, {
        customerEmail: order.customer_email || order.customer?.email,
        paymentRecordId: String(paymentActionResult.recordId),
        submittedAmount: paymentActionResult.submittedAmount,
        reason: paymentActionResult.reason,
      });
    } else if ((paymentActionResult?.action === "verify" && paymentActionResult.amountChanged) || paymentActionResult?.action === "adjust") {
      void sendOrderNotification("payment_amount_updated", order, {
        customerEmail: order.customer_email || order.customer?.email,
        paymentRecordId: String(paymentActionResult.recordId),
        submittedAmount: paymentActionResult.submittedAmount,
        previousAmount: paymentActionResult.previousAmount,
        confirmedAmount: paymentActionResult.verifiedAmount,
        difference: paymentActionResult.difference,
        wasAdjustment: paymentActionResult.wasAdjustment,
        reason: paymentActionResult.reason,
      });
    } else if (paymentActionResult?.action === "exception_request") {
      void sendOrderNotification("downpayment_exception_requested", order, {
        customerEmail: order.customer_email || order.customer?.email,
        paymentRecordId: String(paymentActionResult.recordId),
        acceptedAmount: paymentActionResult.acceptedAmount,
        shortfall: paymentActionResult.shortfall,
      });
    } else if (paymentActionResult?.action === "verify") {
      void sendOrderNotification("payment_proof_confirmed", order, {
        customerEmail: order.customer_email || order.customer?.email,
        previousStatus: previousPaymentStatus,
        confirmedAmount: paymentActionResult.verifiedAmount,
        paymentRecordId: String(paymentActionResult.recordId),
      });
    } else if (paymentActionResult?.action === "record") {
      void sendOrderNotification("admin_payment_recorded", order, {
        customerEmail: order.customer_email || order.customer?.email,
        previousStatus: previousPaymentStatus,
        confirmedAmount: paymentActionResult.verifiedAmount,
        paymentRecordId: String(paymentActionResult.recordId),
        reason: paymentActionResult.reason,
      });
      if (paymentActionResult.exception) {
        void sendOrderNotification("downpayment_exception_approved", order, {
          customerEmail: order.customer_email || order.customer?.email,
          paymentRecordId: String(paymentActionResult.recordId),
          acceptedAmount: paymentActionResult.exception.acceptedAmount,
          shortfall: paymentActionResult.exception.shortfall,
          reason: paymentActionResult.reason,
        });
      }
    } else if (paymentActionResult?.action === "exception_approve") {
      void sendOrderNotification("downpayment_exception_approved", order, {
        customerEmail: order.customer_email || order.customer?.email,
        paymentRecordId: String(paymentActionResult.recordId),
        acceptedAmount: paymentActionResult.verifiedAmount,
        shortfall: paymentActionResult.exception.shortfall,
        reason: paymentActionResult.reason,
      });
    } else if (paymentProofJustConfirmed) {
      void sendOrderNotification("payment_proof_confirmed", order, {
        customerEmail: order.customer_email || order.customer?.email,
        previousStatus: previousPaymentStatus,
        confirmedAmount: confirmedPaymentAmount,
      });
    } else if (currentPaidAmount > previousPaidAmount || previousPaymentStatus !== order.payment_status) {
      void sendOrderNotification("transaction_update", order, {
        customerEmail: order.customer_email || order.customer?.email,
        previousStatus: previousPaymentStatus,
        confirmedAmount: Math.max(currentPaidAmount - previousPaidAmount, 0),
      });
    }
    if (previousContractStatus !== "accepted" && String(order.contract_status || "").toLowerCase() === "accepted") {
      void sendOrderNotification("contract_accepted", order);
    }
    if (previousOrderStatus !== "cancelled" && String(order.status || "").toLowerCase() === "cancelled") {
      void sendOrderNotification("order_cancelled", order, {
        audience: "customer",
        customerEmail: order.customer_email || order.customer?.email,
        date: new Date(),
        reason: req.body?.reason || req.body?.cancellation_reason || "",
      });
    }
    const currentWarranty = JSON.stringify({
      period: order.warranty_period,
      start: order.warranty_start_date,
      end: order.warranty_expiry_date,
      status: order.warranty_status,
      items: (order.items || []).map((item) => [item.warranty_period, item.warranty_start_date, item.warranty_expiry_date, item.warranty_status]),
    });
    const warrantyLines = getWarrantyEmailLines(order);
    if (previousWarranty !== currentWarranty && warrantyLines.length > 0) {
      void sendOrderNotification("warranty_notification", order, { audience: "customer", warrantyLines });
    }
  } catch (error) {
    console.error("Update order status error:", error);
    res.status(500).json({ success: false, message: "Unable to update order", error: error.message });
  }
};

export const deleteOrderReview = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    if (req.query.itemIndex !== undefined) {
      const itemIndex = Number(req.query.itemIndex);
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
        return res.status(400).json({ success: false, message: "A valid product index is required." });
      }
      if (!order.items[itemIndex]?.review?.submittedAt) {
        return res.status(404).json({ success: false, message: "Product feedback not found." });
      }

      order.items[itemIndex].review = null;
      order.markModified(`items.${itemIndex}.review`);
      await order.save();
      return res.json({ success: true, order });
    }

    if (!order.review || (!order.review.submittedAt && !order.review.rating)) {
      return res.status(404).json({ success: false, message: "Customer feedback not found." });
    }

    order.review = undefined;
    order.markModified("review");
    await order.save();

    return res.json({ success: true, order });
  } catch (error) {
    console.error("Delete order review error:", error);
    return res.status(500).json({ success: false, message: "Unable to delete customer feedback.", error: error.message });
  }
};

export const setOrderReviewVisibility = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    const hiddenFromCustomers = req.body?.hiddenFromCustomers;
    if (typeof hiddenFromCustomers !== "boolean") {
      return res.status(400).json({ success: false, message: "Review visibility must be true or false." });
    }

    if (req.body?.itemIndex !== undefined && req.body?.itemIndex !== null) {
      const itemIndex = Number(req.body.itemIndex);
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
        return res.status(400).json({ success: false, message: "A valid product index is required." });
      }
      const review = order.items[itemIndex]?.review;
      if (!review?.submittedAt) return res.status(404).json({ success: false, message: "Product feedback not found." });
      review.hiddenFromCustomers = hiddenFromCustomers;
      order.markModified(`items.${itemIndex}.review`);
    } else {
      if (!order.review?.submittedAt && !order.review?.rating) {
        return res.status(404).json({ success: false, message: "Customer feedback not found." });
      }
      order.review.hiddenFromCustomers = hiddenFromCustomers;
      order.markModified("review");
    }

    await order.save();
    return res.json({ success: true, order, hiddenFromCustomers });
  } catch (error) {
    console.error("Set order review visibility error:", error);
    return res.status(500).json({ success: false, message: "Unable to update review visibility." });
  }
};

export const respondToCustomerReview = async (req, res) => {
  try {
    const responseText = req.body?.response;
    if (typeof responseText !== "string" || !responseText.trim() || responseText.trim().length > 1000) {
      return res.status(400).json({ success: false, message: "Response must be between 1 and 1000 characters." });
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    const rawItemIndex = req.body?.itemIndex;
    const hasItemIndex = rawItemIndex !== undefined && rawItemIndex !== null;
    let review;
    let productName;
    let isFirstResponse = false;
    if (hasItemIndex) {
      const itemIndex = Number(rawItemIndex);
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
        return res.status(400).json({ success: false, message: "A valid product index is required." });
      }
      review = order.items[itemIndex]?.review;
      productName = order.items[itemIndex]?.name || order.items[itemIndex]?.product_name || "your product";
      if (!review?.submittedAt && !review?.rating) return res.status(404).json({ success: false, message: "Product feedback not found." });
      isFirstResponse = !String(review.adminResponse || "").trim();
      review.adminResponse = responseText.trim();
      review.adminRespondedAt = new Date();
      review.adminRespondedBy = req.user.id;
      order.markModified(`items.${itemIndex}.review`);
    } else {
      review = order.review;
      productName = order.items?.length > 1 ? "your project" : order.items?.[0]?.name || "your project";
      if (!review || (!review.submittedAt && !review.rating)) return res.status(404).json({ success: false, message: "Customer feedback not found." });
      isFirstResponse = !String(review.adminResponse || "").trim();
      review.adminResponse = responseText.trim();
      review.adminRespondedAt = new Date();
      review.adminRespondedBy = req.user.id;
      order.markModified("review");
    }

    await order.save();
    if (isFirstResponse && order.customer) {
      const submittedAt = review.submittedAt ? new Date(review.submittedAt).getTime() : "legacy";
      const eventKey = `feedback_response_${hasItemIndex ? rawItemIndex : "order"}_${submittedAt}`;
      try {
        await CustomerNotification.updateOne(
          { order: order._id, eventKey },
          { $setOnInsert: {
            customer: order.customer,
            order: order._id,
            eventKey,
            type: "feedback_response",
            title: "ACGC SERVICES",
            message: `An admin responded to your feedback for ${productName}.`,
            tracking: order.tracking || "",
            stageKey: "feedback_response",
            stageName: "ACGC SERVICES",
            itemIndex: hasItemIndex ? Number(rawItemIndex) : null,
            productName,
          } },
          { upsert: true },
        );
      } catch (notificationError) {
        if (notificationError?.code !== 11000) throw notificationError;
      }
    }
    return res.json({ success: true, order });
  } catch (error) {
    console.error("Respond to customer review error:", error);
    return res.status(500).json({ success: false, message: "Unable to save admin response." });
  }
};

export const submitOrderReview = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { rating, title, comment, tags = [], photos = [], itemIndex: rawItemIndex } = req.body;

    if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Rating must be a number between 1 and 5." });
    }
    if (!Array.isArray(tags)) {
      return res.status(400).json({ success: false, message: "Review tags must be an array." });
    }
    if (!comment || typeof comment !== "string" || comment.trim().length > 500) {
      return res.status(400).json({ success: false, message: "Comment must be between 10 and 500 characters." });
    }
    const reviewTagLabels = {
      quality: "Product Quality",
      service: "Professional Service",
      installation: "Installation Experience",
    };
    const reviewTags = [...new Set(tags.filter((tag) => typeof tag === "string" && reviewTagLabels[tag]))];
    const commentBody = reviewTags.reduce((body, tag) => (
      body.replace(new RegExp(`^${reviewTagLabels[tag]}:\\s*`, "gim"), "")
    ), comment.trim()).trim();
    if (commentBody.length < 10) {
      return res.status(400).json({ success: false, message: "Comment must be between 10 and 500 characters." });
    }
    if (!Array.isArray(photos)) {
      return res.status(400).json({ success: false, message: "Photos must be an array." });
    }
    if (photos.length > 5) {
      return res.status(400).json({ success: false, message: "You may upload up to 5 photos." });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }
    if (!order.customer || order.customer.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to review this order." });
    }

    const orderStatus = String(order.status || "").toLowerCase();
    const invalidReviewStatuses = ["cancelled", "declined", "contract_declined", "rejected"];
    const isStageComplete = (stage) =>
      stage?.completed === true || ["done", "completed"].includes(String(stage?.status || "").toLowerCase());
    const orderStages = Array.isArray(order.progress_stages) ? order.progress_stages : [];
    const orderStagesComplete = orderStages.length > 0 && orderStages.every(isStageComplete);
    const isBatchOrder = Array.isArray(order.items) && order.items.length > 1;
    const batchItemsComplete = isBatchOrder && order.items.every((item) => {
      const itemStages = Array.isArray(item.progress_stages) ? item.progress_stages : [];
      return itemStages.length > 0
        ? itemStages.every(isStageComplete)
        : Number(item.progress) >= 100;
    });
    const parentOrderComplete = orderStatus === "completed" && Number(order.progress) >= 100;
    const isCompleted =
      !invalidReviewStatuses.includes(orderStatus) &&
      (parentOrderComplete || orderStagesComplete || batchItemsComplete);
    if (!isCompleted) {
      return res.status(400).json({ success: false, message: "Only completed orders may be reviewed." });
    }

    const itemIndex = rawItemIndex === undefined || rawItemIndex === null ? null : Number(rawItemIndex);
    if (isBatchOrder && itemIndex === null) {
      return res.status(400).json({ success: false, message: "Select the product you want to review." });
    }
    if (itemIndex !== null && (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length)) {
      return res.status(400).json({ success: false, message: "A valid product index is required." });
    }

    const reviewTarget = itemIndex === null ? order : order.items[itemIndex];
    const existingReview = reviewTarget.review?.submittedAt;
    if (existingReview && !isWithinReviewEditWindow(existingReview)) {
      return res.status(400).json({ success: false, message: "This review is locked and can no longer be edited." });
    }

    const now = new Date();
    const savedReview = {
      rating,
      title: title?.trim() || "",
      comment: comment.trim(),
      tags: reviewTags,
      photos: photos.slice(0, 5).map((photo) => (typeof photo === "string" ? photo : "")).filter(Boolean),
      submittedAt: existingReview || now,
      updatedAt: now,
    };
    reviewTarget.review = savedReview;
    if (itemIndex !== null) order.markModified(`items.${itemIndex}.review`);

    await order.save();

    const productName = itemIndex === null ? order.items?.[0]?.name : order.items[itemIndex]?.name;
    const reviewMessage = buildReviewNotificationMessage(order, savedReview, productName);
    const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
    const linkedCustomer = await getCurrentCustomerContact(req.user.id);
    const customerEmail = linkedCustomer?.email || req.user.email || order.customer_email || "";

    res.json({ success: true, order });

    void sendMail({
      to: adminEmail,
      subject: `New customer review received for ${productName || order.tracking}`,
      text: reviewMessage,
    }).catch((mailError) => console.error("Review notification email failed:", mailError));

    if (customerEmail) {
      const reviewEmail = buildCustomerEmailTemplate({
        title: "Thank you for your review",
        summary: "Thank you for sharing your feedback. Your review has been submitted successfully.",
        status: "Review Received",
        orderId: order.tracking || order._id,
        fields: [
          ["Product", productName || "Project"],
          ["Rating", `${"★".repeat(savedReview.rating || 0)}${"☆".repeat(Math.max(0, 5 - (savedReview.rating || 0)))}`],
          ...(savedReview.title ? [["Review title", savedReview.title]] : []),
          ...(savedReview.comment ? [["Your review", savedReview.comment]] : []),
        ],
        nextSteps: "Your feedback helps us improve our products and services.",
        actionUrl: buildFrontendUrl("/customer-dashboard", { tab: "orders", orderId: order._id }),
        actionLabel: "View order",
      });
      void sendMail({
        to: customerEmail,
        subject: "Thank you for your review",
        ...reviewEmail,
      }).catch((mailError) => console.error("Customer review confirmation email failed:", mailError));
    }
  } catch (error) {
    console.error("Submit order review error:", error);
    res.status(500).json({ success: false, message: "Unable to submit review.", error: error.message });
  }
};

const getProductReviewOrdersFilter = (productId) => ({
  "items.product_id": productId,
  $or: [
    { "review.submittedAt": { $ne: null } },
    { items: { $elemMatch: { product_id: productId, "review.submittedAt": { $ne: null } } } },
  ],
});

export const getProductReviewSummary = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ success: false, message: "Product ID is required." });
    }

    const orders = await Order.find(getProductReviewOrdersFilter(productId))
      .select("review items.product_id items.review")
      .lean();
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let total = 0;
    let ratingTotal = 0;

    for (const order of orders) {
      for (const item of order.items || []) {
        if (String(item.product_id) !== String(productId)) continue;
        const review = item.review?.submittedAt ? item.review : order.review;
        const rating = Number(review?.rating);
        if (!review?.submittedAt || review.hiddenFromCustomers === true || !Number.isFinite(rating) || rating < 1 || rating > 5) continue;
        counts[Math.round(rating)] += 1;
        ratingTotal += rating;
        total += 1;
      }
    }

    return res.json({
      success: true,
      average: total ? ratingTotal / total : 0,
      total,
      counts,
    });
  } catch (error) {
    console.error("Get product review summary error:", error);
    return res.status(500).json({ success: false, message: "Unable to fetch product ratings." });
  }
};

export const getProductReviewSummaries = async (req, res) => {
  try {
    const requestedIds = Array.isArray(req.query.productIds)
      ? req.query.productIds
      : [req.query.productIds].filter(Boolean);
    const productIds = [...new Set(requestedIds.map((id) => String(id).trim()))];

    if (!productIds.length || productIds.length > 100 || productIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ success: false, message: "Provide between 1 and 100 valid product IDs." });
    }

    const productIdSet = new Set(productIds);
    const orders = await Order.find({
      "items.product_id": { $in: productIds },
      $or: [
        { "review.submittedAt": { $ne: null } },
        {
          items: {
            $elemMatch: {
              product_id: { $in: productIds },
              "review.submittedAt": { $ne: null },
            },
          },
        },
      ],
    }).select("review items.product_id items.review").lean();

    const summaries = Object.fromEntries(productIds.map((id) => [id, {
      average: 0,
      total: 0,
      counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      ratingTotal: 0,
    }]));

    for (const order of orders) {
      for (const item of order.items || []) {
        const productId = String(item.product_id);
        if (!productIdSet.has(productId)) continue;
        const review = item.review?.submittedAt ? item.review : order.review;
        const rating = Number(review?.rating);
        if (!review?.submittedAt || review.hiddenFromCustomers === true || !Number.isFinite(rating) || rating < 1 || rating > 5) continue;
        const summary = summaries[productId];
        summary.counts[Math.round(rating)] += 1;
        summary.ratingTotal += rating;
        summary.total += 1;
      }
    }

    for (const summary of Object.values(summaries)) {
      summary.average = summary.total ? summary.ratingTotal / summary.total : 0;
      delete summary.ratingTotal;
    }

    return res.json({ success: true, summaries });
  } catch (error) {
    console.error("Get product review summaries error:", error);
    return res.status(500).json({ success: false, message: "Unable to fetch product ratings." });
  }
};

export const getCustomerFeedbackSummary = async (req, res) => {
  try {
    const orders = await Order.find({
      $or: [
        { "review.submittedAt": { $ne: null } },
        { "items.review.submittedAt": { $ne: null } },
      ],
    }).select("review items.review").lean();
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let total = 0;
    let ratingTotal = 0;
    const addReview = (review) => {
      if (!review?.submittedAt || review.hiddenFromCustomers === true) return;
      const rating = Number(review.rating);
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) return;
      counts[Math.round(rating)] += 1;
      ratingTotal += rating;
      total += 1;
    };

    for (const order of orders) {
      addReview(order.review);
      for (const item of order.items || []) addReview(item.review);
    }

    return res.json({ success: true, average: total ? ratingTotal / total : 0, total, counts });
  } catch (error) {
    console.error("Get customer feedback summary error:", error);
    return res.status(500).json({ success: false, message: "Unable to fetch customer ratings." });
  }
};

export const getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ success: false, message: "Product ID is required." });
    }

    const reviews = await Order.find(getProductReviewOrdersFilter(productId))
      .populate("customer", "first_name last_name")
      .populate("items.product_id", "name")
      .sort({ "review.submittedAt": -1 })
      .lean();

    const mappedReviews = reviews
      .flatMap((order) =>
        (order.items || [])
          .filter((item) => item.product_id && String(item.product_id._id || item.product_id) === String(productId))
          .flatMap((item, itemIndex) => {
            if (!item.product_id || String(item.product_id._id || item.product_id) !== String(productId)) return [];
            const review = item.review?.submittedAt ? item.review : order.review;
            if (!review?.submittedAt || review.hiddenFromCustomers === true) return [];
            return [{
              orderId: order._id,
              tracking: order.tracking,
              productName: item.name,
              customerName: order.customer ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() : order.customer_name || "Customer",
              rating: review.rating || 0,
              title: review.title || "",
              comment: review.comment || "",
              tags: review.tags || [],
              photos: review.photos || [],
              adminResponse: review.adminResponse || "",
              submittedAt: review.submittedAt || null,
              itemIndex,
            }];
          })
      )
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    res.json({ success: true, reviews: mappedReviews });
  } catch (error) {
    console.error("Get product reviews error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch product reviews.", error: error.message });
  }
};

export const respondToContract = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { action } = req.body;

    if (!action || !["accept", "decline"].includes(action)) {
      return res.status(400).json({ success: false, message: "Contract action must be accept or decline." });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (!order.customer || order.customer.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to respond to this contract." });
    }
    if (String(order.status || "").toLowerCase() === "cancelled") {
      return res.status(409).json({ success: false, message: "Cancelled projects cannot accept or change contracts." });
    }

    const orderStatus = (order.status || "").toString().toLowerCase();
    const contractStatus = (order.contract_status || "").toString().toLowerCase();
    const hasVerifiedAcceptance = (order.order_type === "walk_in_customer"
      && order.acceptance_method === "walk_in_signed_contract"
      && Boolean(order.signed_contract_url)
      && Boolean(order.contract_signed_date))
      || (order.order_type !== "walk_in_customer"
        && order.acceptance_method === "online"
        && order.acceptedByCustomer === true);
    const staleAcceptedWithoutCustomerProof = order.order_type !== "walk_in_customer"
      && !hasVerifiedAcceptance
      && Boolean(order.contractSentAt)
      && (orderStatus === "contract_accepted" || contractStatus === "accepted");
    const isAwaitingCustomerResponse = (
      (orderStatus === "contract_sent" || orderStatus === "site_inspection" || contractStatus === "sent") &&
      !["accepted", "declined"].includes(contractStatus) &&
      !["contract_accepted", "contract_declined", "cancelled"].includes(orderStatus)
    ) || staleAcceptedWithoutCustomerProof;

    if (action === "accept" && hasVerifiedAcceptance) {
      return res.json({ success: true, order, message: "Contract already accepted." });
    }

    if (!isAwaitingCustomerResponse) {
      return res.status(400).json({ success: false, message: "Contract cannot be responded to at this stage." });
    }

    if (order.order_type === "walk_in_customer") {
      return res.status(400).json({ success: false, message: "Walk-in contracts must be verified by an admin." });
    }

    if (action === "accept") {
      const acceptedAt = new Date();
      const acceptanceUpdate = {
        contract_status: "accepted",
        status: "contract_accepted",
        contractStatus: "Accepted",
        acceptance_method: "online",
        acceptanceMethod: "Online",
        acceptedByCustomer: true,
        acceptedAt,
        contract_signed_date: acceptedAt,
        inspection_status: "completed",
        inspection_completed_at: acceptedAt,
      };
      if (order.transactionCreated !== true) {
        acceptanceUpdate.transactionCreated = true;
        acceptanceUpdate.transactionCreatedAt = acceptedAt;
      }
      const activeContract = Array.isArray(order.contractHistory)
        ? order.contractHistory.findIndex((entry) => entry.status === "Current")
        : -1;
      if (activeContract >= 0) {
        acceptanceUpdate[`contractHistory.${activeContract}.status`] = "Accepted";
        acceptanceUpdate[`contractHistory.${activeContract}.acceptedAt`] = acceptedAt;
        acceptanceUpdate[`contractHistory.${activeContract}.acceptanceMethod`] = "Online";
      }
      const acceptedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          customer: req.user.id,
          status: order.status,
          contract_status: order.contract_status,
          acceptedByCustomer: { $ne: true },
        },
        { $set: acceptanceUpdate },
        { new: true, runValidators: true },
      );
      if (!acceptedOrder) {
        const latestOrder = await Order.findById(order._id);
        if (latestOrder && (
          (latestOrder.order_type === "walk_in_customer"
            && latestOrder.acceptance_method === "walk_in_signed_contract"
            && Boolean(latestOrder.signed_contract_url)
            && Boolean(latestOrder.contract_signed_date))
          || (latestOrder.order_type !== "walk_in_customer"
            && latestOrder.acceptance_method === "online"
            && latestOrder.acceptedByCustomer === true)
        )) {
          return res.json({ success: true, duplicate: true, order: latestOrder, message: "Contract already accepted." });
        }
        return res.status(409).json({ success: false, message: "The contract changed while you were accepting it. Refresh and review the latest contract." });
      }

      res.json({ success: true, order: acceptedOrder });
      void sendOrderNotification("contract_accepted", acceptedOrder, { customerEmail: req.user.email });
      return;
    }

    order.contract_status = "declined";
    order.status = "cancelled";
    order.contractStatus = "Declined";
    order.contractDeclineReason = "";
    order.contractDeclinedAt = new Date();

    await order.save();
    await ScheduleReservation.deleteMany({ orderId: order._id });

    res.json({ success: true, order });
  } catch (error) {
    console.error("Respond to contract error:", error);
    res.status(500).json({ success: false, message: "Unable to update contract response", error: error.message });
  }
};

export const cancelCustomerOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (!order.customer || order.customer.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to cancel this order." });
    }

    if (order.status === "cancelled") {
      return res.json({ success: true, order, message: "Order already cancelled." });
    }

    const isCompleted = order.status === "completed" || Number(order.progress) >= 100;
    if (isCompleted) {
      return res.status(400).json({
        success: false,
        message: "This order has already been completed and cannot be cancelled.",
      });
    }

    const cancellationReason = String(req.body?.reason || req.body?.cancellation_reason || "").trim();
    const cancellationDate = new Date();
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        customer: req.user.id,
        status: { $nin: ["cancelled", "completed"] },
        $or: [{ progress: { $lt: 100 } }, { progress: null }, { progress: { $exists: false } }],
      },
      { $set: {
        status: "cancelled",
        cancellation_reason: cancellationReason,
        cancellation_date: cancellationDate,
        cancellation_previous_status: order.status || "unknown",
        cancelled_by: String(req.user.id),
        cancelled_by_name: [req.user.first_name, req.user.last_name].filter(Boolean).join(" ").trim() || req.user.name || req.user.email || "Customer",
        ...(order.contract_status === "accepted" ? { contract_status: "declined" } : {}),
      }, $push: {
        progress_audit: {
          $each: [{
            type: "project_cancelled",
            at: cancellationDate,
            by: String(req.user.id),
            byName: [req.user.first_name, req.user.last_name].filter(Boolean).join(" ").trim() || req.user.name || req.user.email || "Customer",
            byRole: "customer",
            reason: cancellationReason,
            previousStatus: order.status || "unknown",
          }],
          $slice: -500,
        },
      } },
      { new: true },
    );

    if (!updatedOrder) {
      const latestOrder = await Order.findById(order._id);
      if (latestOrder?.status === "cancelled") {
        return res.json({ success: true, duplicate: true, order: latestOrder, message: "Order already cancelled." });
      }
      if (latestOrder?.status === "completed" || Number(latestOrder?.progress) >= 100) {
        return res.status(400).json({ success: false, message: "This order has already been completed and cannot be cancelled." });
      }
      return res.status(409).json({ success: false, message: "This order changed and can no longer be cancelled. Refresh your orders and try again." });
    }

    const customerAccount = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { customer_cancellation_count: 1 } },
      { new: true },
    ).select("customer_cancellation_count online_order_cooldown_until");
    const cancellationCount = Number(customerAccount?.customer_cancellation_count) || 0;
    updatedOrder.customer_cancellation_count_at_cancel = cancellationCount;
    await updatedOrder.save();
    await ScheduleReservation.deleteMany({ orderId: updatedOrder._id });
    let cooldownUntil = customerAccount?.online_order_cooldown_until || null;
    let message = "Order cancelled successfully.";
    const cancellationCountInCycle = cancellationCount > 0 ? ((cancellationCount - 1) % 3) + 1 : 0;
    const formattedOrderTracking = updatedOrder.tracking || updatedOrder._id;
    if (cancellationCountInCycle === 1) {
      message = "Order cancelled. This is cancellation 1 of 3; a third cancellation triggers a 7-day online ordering restriction.";
    } else if (cancellationCountInCycle === 2) {
      message = "Order cancelled. This is cancellation 2 of 3; your next cancellation triggers a 7-day online ordering restriction.";
    }
    if (cancellationCountInCycle === 3) {
      cooldownUntil = new Date(cancellationDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      await User.updateOne({ _id: req.user.id }, { $set: { online_order_cooldown_until: cooldownUntil } });
      const formattedCooldownUntil = new Intl.DateTimeFormat("en-PH", { timeZone: RUSH_ORDER_TIME_ZONE, year: "numeric", month: "long", day: "numeric" }).format(cooldownUntil);
      message = `Order cancelled. Online ordering is restricted for 7 days, until ${formattedCooldownUntil}. Please visit our shop or contact us by phone if you need to place an order during this period.`;
    }

    const cooldownTriggered = cancellationCountInCycle === 3;
    const eventKey = `order_cancellation_policy:${cancellationCount}`;
    const formattedCooldownUntil = cooldownUntil
      ? new Intl.DateTimeFormat("en-PH", { timeZone: RUSH_ORDER_TIME_ZONE, year: "numeric", month: "long", day: "numeric" }).format(cooldownUntil)
      : "";
    const notification = cooldownTriggered
      ? {
          type: "order_cancellation_cooldown",
          title: "7-Day Online Ordering Restriction",
          message: `Your third order cancellation has activated a 7-day restriction on online ordering. You can place another online order after ${formattedCooldownUntil}. During these 7 days, please visit our shop or contact us by phone if you need to place an order. This restriction applies to order ${formattedOrderTracking}.`,
          stageKey: "order_cancellation_cooldown",
          stageName: "7-Day Online Ordering Restriction",
        }
      : {
          type: "order_cancellation_warning",
          title: "Cancellation Policy Reminder",
          message: cancellationCountInCycle === 1
            ? `This is your first cancellation in the current policy cycle (1 of 3). Reaching 3 cancellations will restrict online ordering for 7 days. Please visit our shop or contact us by phone during any restriction. This reminder is for order ${formattedOrderTracking}.`
            : `This is your second cancellation in the current policy cycle (2 of 3). Your next cancellation will restrict online ordering for 7 days. Please visit our shop or contact us by phone during any restriction. This reminder is for order ${formattedOrderTracking}.`,
          stageKey: "order_cancellation_warning",
          stageName: "Cancellation Policy Reminder",
        };
    await CustomerNotification.updateOne(
      { order: updatedOrder._id, eventKey },
      { $setOnInsert: {
        customer: req.user.id,
        order: updatedOrder._id,
        eventKey,
        ...notification,
        tracking: updatedOrder.tracking || "",
      } },
      { upsert: true },
    );

    res.json({
      success: true,
      order: await orderWithCustomerNotifications(updatedOrder),
      message,
      customer_cancellation_count: cancellationCount,
      cooldown_until: cooldownUntil,
    });
    void sendOrderNotification("order_cancelled", updatedOrder, {
      customerEmail: req.user.email || order.customer_email,
      date: cancellationDate,
      reason: cancellationReason,
    });
  } catch (error) {
    console.error("Cancel customer order error:", error);
    res.status(500).json({ success: false, message: "Unable to cancel order", error: error.message });
  }
};

export const submitCustomerPaymentProof = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount, payment_method, transaction_number, proof_file_name, proof_file_url } = req.body || {};

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    if (!order.customer || order.customer.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to update payment proof for this order." });
    }
    if (String(order.status || "").toLowerCase() === "cancelled") {
      return res.status(409).json({ success: false, message: "Cancelled projects cannot receive new payment submissions. Existing payment history is preserved." });
    }

    initializePaymentLedger(order);
    if ((order.payment_records || []).some((record) => record.status === "pending")) {
      return res.status(409).json({
        success: false,
        message: "Your previous payment is awaiting confirmation before another payment can be submitted.",
      });
    }

    const { remainingAmount, downpaymentRemaining } = getOrderPaymentAmounts(order);
    const validation = validatePaymentAmount(amount, remainingAmount, downpaymentRemaining);
    if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
    const normalizedAmount = validation.amount;

    const submittedAt = new Date();
    const paymentRecord = {
      submitted_amount: normalizedAmount,
      verified_amount: null,
      status: "pending",
      payment_method: payment_method || order.payment_method || "Cash",
      transaction_number: transaction_number || "",
      proof_file_name: proof_file_name || "",
      proof_file_url: proof_file_url || "",
      submitted_at: submittedAt,
    };
    order.payment_records.push(paymentRecord);
    order.payment_proof_amount = normalizedAmount;
    order.payment_proof_submitted_at = submittedAt;
    order.payment_proof_confirmed_at = null;
    order.payment_proof_file_name = paymentRecord.proof_file_name;
    order.payment_proof_file_url = paymentRecord.proof_file_url;
    order.payment_method = paymentRecord.payment_method;
    order.transaction_number = paymentRecord.transaction_number;
    order.amount_paid = getOrderPaymentAmounts(order).paidAmount;
    order.payment_status = getOrderPaymentStatus(order);

    await order.save();

    res.json({
      success: true,
      message: "Payment proof submitted successfully.",
      order,
    });
    void sendOrderNotification("payment_proof_submitted", order, { customerEmail: req.user.email || order.customer_email });
  } catch (error) {
    console.error("Submit customer payment proof error:", error);
    res.status(500).json({ success: false, message: "Unable to submit payment proof", error: error.message });
  }
};

export const respondToInstallationSchedule = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { action, reason, preferredInstallationDate, preferredInstallationTime, notes } = req.body;

    if (!action || !["accept", "reschedule", "accept_preferred"].includes(action)) {
      return res.status(400).json({ success: false, message: "Schedule action must be accept, reschedule, or accept_preferred." });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (String(order.status || "").toLowerCase() === "cancelled") {
      return res.status(409).json({ success: false, message: "Cancelled projects cannot be scheduled or rescheduled." });
    }
    const previousProgressStages = (order.progress_stages || []).map((stage) => stage.toObject?.() || { ...stage });
    const previousSchedule = {
      inspection_date: order.inspection_date, inspection_time: order.inspection_time,
      inspection_duration_minutes: order.inspection_duration_minutes, inspection_travel_minutes: order.inspection_travel_minutes,
      estimated_installation_date: order.estimated_installation_date, estimated_installation_time: order.estimated_installation_time,
      installation_duration_minutes: order.installation_duration_minutes,
    };

    const isCustomer = order.customer && order.customer.toString() === req.user.id;
    const isAdmin = ["admin", "super_admin"].includes(req.user.role);

    // Accept preferred requires admin, other actions require customer
    if (action === "accept_preferred") {
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: "Only admins can accept preferred schedules." });
      }
    } else {
      if (!isCustomer) {
        return res.status(403).json({ success: false, message: "Not authorized to respond to this installation schedule." });
      }
    }

    const scheduleStageKeys = ["installation_scheduling", "installation_scheduled", "installation_agreement"];
    const scheduleStages = Array.isArray(order.progress_stages)
      ? order.progress_stages.filter((stage) => {
          const scheduleStageKey = (stage.key || stage.name || "").toString().toLowerCase().replace(/\s+/g, "_");
          return scheduleStageKeys.includes(scheduleStageKey);
        })
      : [];
    const scheduleStage =
      scheduleStages.find((stage) => stage.customerResponse === "reschedule_requested") ||
      scheduleStages.find((stage) => stage.proposedInstallationDate || stage.proposedInstallationTime) ||
      scheduleStages[0] ||
      null;

    if (!scheduleStage) {
      return res.status(400).json({ success: false, message: "Installation schedule is not available for response." });
    }

    const hasProposal = scheduleStage.proposedInstallationDate || scheduleStage.proposedInstallationTime;
    const hasPreferredProposal = scheduleStage.customerPreferredInstallationDate || scheduleStage.customerPreferredInstallationTime;

    if (action !== "accept_preferred" && !hasProposal) {
      return res.status(400).json({ success: false, message: "No installation proposal is available to respond to." });
    }

    if (action === "accept" || action === "accept_preferred") {
      const acceptedDate = action === "accept_preferred"
        ? scheduleStage.customerPreferredInstallationDate
        : scheduleStage.proposedInstallationDate;
      const acceptedTime = action === "accept_preferred"
        ? scheduleStage.customerPreferredInstallationTime
        : scheduleStage.proposedInstallationTime;
      if (!acceptedDate || !acceptedTime) return res.status(400).json({ success: false, message: "An installation date and time are required to confirm this schedule." });
      const installationDateError = getInstallationDateError(order.inspection_date, acceptedDate);
      if (installationDateError) return res.status(400).json({ success: false, message: installationDateError });
      const scheduleError = await validateOrderSchedules({
        inspection_date: order.inspection_date,
        inspection_time: order.inspection_time,
        inspection_duration_minutes: order.inspection_duration_minutes,
        inspection_travel_minutes: order.inspection_travel_minutes,
        estimated_installation_date: acceptedDate,
        estimated_installation_time: acceptedTime,
        installation_duration_minutes: order.installation_duration_minutes,
      }, order._id, order);
      if (scheduleError) return res.status(409).json({ success: false, code: "SCHEDULE_UNAVAILABLE", message: scheduleError });
      order.estimated_installation_date = new Date(acceptedDate);
      order.estimated_installation_time = String(acceptedTime);
    }

    if (action === "accept") {
      const alreadyAccepted = scheduleStage.customerResponse === "accepted" && scheduleStage.completed;
      if (alreadyAccepted) {
        return res.json({ success: true, order, message: "Installation schedule already accepted." });
      }

      scheduleStage.customerResponse = "accepted";
      scheduleStage.customerResponseAt = new Date();
      scheduleStage.customerDeclineReason = "";
      scheduleStage.customerPreferredInstallationDate = null;
      scheduleStage.customerPreferredInstallationTime = "";
      scheduleStage.customerRescheduleNotes = "";
      scheduleStage.completedAt = scheduleStage.completed ? scheduleStage.completedAt || new Date() : new Date();
      scheduleStage.completed = true;
      scheduleStage.status = "done";
      scheduleStage.date = new Date();
      order.status = order.status === "contract_accepted" ? "contract_accepted" : order.status;
    } else if (action === "accept_preferred") {
      // Admin accepting customer's preferred reschedule
      const alreadyAcceptedPreferred =
        scheduleStage.customerResponse === "accepted" &&
        scheduleStage.completed &&
        (scheduleStage.customerPreferredInstallationDate || scheduleStage.customerPreferredInstallationTime);
      if (alreadyAcceptedPreferred) {
        return res.json({
          success: true,
          order: await orderWithCustomerNotifications(order),
          message: "Customer preferred schedule already accepted.",
        });
      }

      if (scheduleStage.customerResponse !== "reschedule_requested") {
        return res.status(400).json({
          success: false,
          message: `Customer has not requested a reschedule. Current status: ${scheduleStage.customerResponse || "unknown"}.`,
        });
      }

      if (!hasPreferredProposal) {
        return res.status(400).json({
          success: false,
          message: "No customer preferred schedule is available to accept. Missing date or time.",
        });
      }

      // Update the proposed date/time to the customer's preferred values
      scheduleStage.proposedInstallationDate = scheduleStage.customerPreferredInstallationDate
        ? new Date(scheduleStage.customerPreferredInstallationDate)
        : null;
      scheduleStage.proposedInstallationTime = scheduleStage.customerPreferredInstallationTime || "";
      scheduleStage.customerResponse = "accepted";
      scheduleStage.customerResponseAt = new Date();
      scheduleStage.completedAt = scheduleStage.completed ? scheduleStage.completedAt || new Date() : new Date();
      scheduleStage.completed = true;
      scheduleStage.status = "done";
      scheduleStage.date = new Date();
      order.status = order.status === "contract_accepted" ? "contract_accepted" : order.status;
    } else {
      if (!reason || !preferredInstallationDate || !preferredInstallationTime) {
        return res.status(400).json({
          success: false,
          message: "Reschedule requests require a reason, preferred installation date, and preferred installation time.",
        });
      }

      scheduleStage.customerResponse = "reschedule_requested";
      scheduleStage.customerResponseAt = new Date();
      scheduleStage.customerDeclineReason = reason.trim();
      scheduleStage.customerPreferredInstallationDate = new Date(preferredInstallationDate);
      scheduleStage.customerPreferredInstallationTime = preferredInstallationTime.trim();
      scheduleStage.customerRescheduleNotes = notes ? notes.trim() : "";
      scheduleStage.completed = false;
      scheduleStage.status = "pending";
      order.status = order.status === "contract_accepted" ? "contract_accepted" : order.status;
    }

    order.progress_stages = applyInstallationNotificationTimestamps(
      previousProgressStages,
      order.progress_stages.map((stage) => stage.toObject?.() || { ...stage })
    );
    await saveWithScheduleReservations(order, {
      inspection_date: order.inspection_date,
      inspection_time: order.inspection_time,
      inspection_duration_minutes: order.inspection_duration_minutes,
      inspection_travel_minutes: order.inspection_travel_minutes,
      estimated_installation_date: order.estimated_installation_date,
      estimated_installation_time: order.estimated_installation_time,
      installation_duration_minutes: order.installation_duration_minutes,
    }, () => order.save(), previousSchedule);
    await persistInstallationNotifications(order, order.progress_stages, null, "", { includeCompletion: false });

    res.json({ success: true, order: await orderWithCustomerNotifications(order) });
  } catch (error) {
    console.error("Respond to installation schedule error:", error);
    res.status(500).json({ success: false, message: "Unable to update installation schedule response", error: error.message });
  }
};

export const updateOrderInspection = async (req, res) => {
  let updateData = {};

  try {
    if (!["admin", "super_admin", "skilled_worker"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { orderId } = req.params;
    const { inspection_status, inspection_date, inspection_time, inspection_duration_minutes, inspection_travel_minutes, estimated_installation_date, estimated_installation_time, installation_duration_minutes, project_additional_charges, inspection_notes, issues_found, shipping_address, payment_terms, agreed_payment_date, items, customer_name, customer_email, customer_phone, has_account_on_website, downpayment_received, required_downpayment_amount, manual_override, warranty_period, custom_warranty_days, warranty_assignment_mode, is_rush_order } = req.body;

    const isValidScheduleTime = (value) => value === undefined || value === null || value === "" || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value));
    if (!isValidScheduleTime(inspection_time) || !isValidScheduleTime(estimated_installation_time)) {
      return res.status(400).json({ success: false, message: "Inspection and installation times must use a valid 24-hour time." });
    }
    if ((inspection_duration_minutes !== undefined && (!Number.isFinite(Number(inspection_duration_minutes)) || Number(inspection_duration_minutes) < 30)) || (inspection_travel_minutes !== undefined && (!Number.isFinite(Number(inspection_travel_minutes)) || Number(inspection_travel_minutes) < 0)) || (installation_duration_minutes !== undefined && (!Number.isFinite(Number(installation_duration_minutes)) || Number(installation_duration_minutes) < 1))) {
      return res.status(400).json({ success: false, message: "Inspection duration must be at least 30 minutes; travel and installation duration must be non-negative valid minutes." });
    }

    if (manual_override !== undefined && manual_override !== null && String(manual_override).trim() !== ""
      && (!Number.isFinite(Number(manual_override)) || Number(manual_override) < 0)) {
      return res.status(400).json({ success: false, message: "Manual price override must be a valid non-negative amount." });
    }

    updateData = {
      status: "site_inspection",
    };

    if (inspection_status !== undefined) updateData.inspection_status = inspection_status;
    if (inspection_date !== undefined) {
      updateData.inspection_date = inspection_date;
      if (inspection_status === undefined || inspection_status === null) {
        updateData.inspection_status = "scheduled";
      }
    }
    if (inspection_time !== undefined) updateData.inspection_time = inspection_time || "";
    if (inspection_duration_minutes !== undefined) updateData.inspection_duration_minutes = Number(inspection_duration_minutes);
    if (inspection_travel_minutes !== undefined) updateData.inspection_travel_minutes = Number(inspection_travel_minutes);
    if (estimated_installation_date !== undefined) {
      const parsedInstallationDate = estimated_installation_date ? new Date(estimated_installation_date) : null;
      if (parsedInstallationDate && Number.isNaN(parsedInstallationDate.getTime())) {
        return res.status(400).json({ success: false, message: "Estimated installation date must be a valid date." });
      }
      updateData.estimated_installation_date = parsedInstallationDate;
    }
    if (estimated_installation_time !== undefined) updateData.estimated_installation_time = estimated_installation_time || "";
    if (installation_duration_minutes !== undefined) updateData.installation_duration_minutes = Number(installation_duration_minutes);
    if (project_additional_charges !== undefined) {
      const normalized = normalizeProjectCharges(project_additional_charges);
      if (normalized.error) return res.status(400).json({ success: false, message: normalized.error });
      updateData.project_additional_charges = normalized.charges;
    }
    if (inspection_notes !== undefined) updateData.inspection_notes = inspection_notes;
    if (issues_found !== undefined) updateData.issues_found = issues_found;
    if (payment_terms !== undefined) updateData.payment_terms = payment_terms || "";
    if (agreed_payment_date !== undefined) {
      const parsedAgreedDate = agreed_payment_date ? new Date(agreed_payment_date) : null;
      if (agreed_payment_date && Number.isNaN(parsedAgreedDate.getTime())) {
        return res.status(400).json({ success: false, message: "Agreed payment date must be a valid date." });
      }
      updateData.agreed_payment_date = parsedAgreedDate;
    }
    if (has_account_on_website !== undefined) updateData.has_account_on_website = Boolean(has_account_on_website);
    if (downpayment_received !== undefined) updateData.downpayment_received = Boolean(downpayment_received);
    if (warranty_period !== undefined) updateData.warranty_period = warranty_period !== null && String(warranty_period).trim() !== "" ? String(warranty_period) : "90";
    if (warranty_assignment_mode !== undefined) updateData.warranty_assignment_mode = warranty_assignment_mode === "per_product" ? "per_product" : "same";
    if (custom_warranty_days !== undefined) updateData.custom_warranty_days = Number(custom_warranty_days) > 0 ? Number(custom_warranty_days) : null;
    if (manual_override !== undefined) updateData.manual_override = Number(manual_override) || 0;
    if (customer_name !== undefined) updateData.customer_name = customer_name || "";
    if (customer_email !== undefined) updateData.customer_email = customer_email || "";
    if (customer_phone !== undefined) updateData.customer_phone = customer_phone || "";
    if (Array.isArray(items)) {
      if (items.length === 0) {
        return res.status(400).json({ success: false, message: "At least one inspection item is required." });
      }
      const repricedItems = await repriceInspectionItems(items);
      const invalidItem = repricedItems.find((item) => !item.product_id || !item.name);
      if (invalidItem) {
        return res.status(400).json({ success: false, message: "Invalid item data in inspection update." });
      }
      updateData.items = repricedItems;
    }
    const order = await Order.findById(orderId).populate(
      "customer",
      "first_name last_name email phone street_address city province zip_code"
    );

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (String(order.status || "").toLowerCase() === "cancelled") {
      return res.status(409).json({ success: false, message: "Cancelled projects cannot receive inspection or installation updates." });
    }
    const pricingInputsUnchanged = (!Array.isArray(items) || areInspectionItemsPricedTheSame(items, order.items || []))
      && getProjectChargePricingSignature(project_additional_charges !== undefined ? updateData.project_additional_charges : order.project_additional_charges)
        === getProjectChargePricingSignature(order.project_additional_charges)
      && (manual_override === undefined || (Number(manual_override) || 0) === (Number(order.manual_override) || 0));
    const getExistingItemForRequest = (requestedItem, index) => {
      const sourceItemId = String(requestedItem?.source_item_id || "").trim();
      if (sourceItemId) {
        return (order.items || []).find((savedItem) => String(savedItem?._id || savedItem?.id || "") === sourceItemId) || null;
      }
      return order.items?.[index] || null;
    };
    if (Array.isArray(updateData.items)) {
      updateData.items = updateData.items.map((item, index) => {
        const savedItem = getExistingItemForRequest(items[index], index);
        const savedLineTotal = Number(savedItem?.line_total) || Number(savedItem?.estimated_price) || 0;
        const sameBasePricing = savedItem
          && getInspectionItemPricingSignature(items[index], { includeProductCharges: false })
            === getInspectionItemPricingSignature(savedItem, { includeProductCharges: false });
        if (!sameBasePricing || savedLineTotal <= 0) return item;
        return {
          ...item,
          line_total: savedLineTotal,
          estimated_price: Number(savedItem?.estimated_price) || savedLineTotal,
        };
      });
    }
    if (shipping_address !== undefined) {
      const normalizedShippingAddress = normalizeAddress(shipping_address || "");
      const addressChanged = normalizeFullAddress(normalizedShippingAddress) !== normalizeFullAddress(order.shipping_address);
      if (addressChanged) {
        const addressError = getStreetAddressError(normalizedShippingAddress);
        if (addressError) return res.status(400).json({ success: false, message: addressError });
        updateData.shipping_address = normalizedShippingAddress;
      }
    }
    const previousSchedule = {
      inspection_date: order.inspection_date, inspection_time: order.inspection_time,
      inspection_duration_minutes: order.inspection_duration_minutes, inspection_travel_minutes: order.inspection_travel_minutes,
      estimated_installation_date: order.estimated_installation_date, estimated_installation_time: order.estimated_installation_time,
      installation_duration_minutes: order.installation_duration_minutes,
    };

    const scheduleError = await validateOrderSchedules({
      inspection_date: inspection_date !== undefined ? inspection_date : order.inspection_date,
      inspection_time: inspection_time !== undefined ? inspection_time : order.inspection_time,
      inspection_duration_minutes: inspection_duration_minutes !== undefined ? inspection_duration_minutes : order.inspection_duration_minutes,
      inspection_travel_minutes: inspection_travel_minutes !== undefined ? inspection_travel_minutes : order.inspection_travel_minutes,
      estimated_installation_date: estimated_installation_date !== undefined ? estimated_installation_date : order.estimated_installation_date,
      estimated_installation_time: estimated_installation_time !== undefined ? estimated_installation_time : order.estimated_installation_time,
      installation_duration_minutes: installation_duration_minutes !== undefined ? installation_duration_minutes : order.installation_duration_minutes,
    }, order._id, order);
    if (scheduleError) return res.status(409).json({ success: false, code: "SCHEDULE_UNAVAILABLE", message: scheduleError });

    const previousInstallationDate = order.estimated_installation_date
      ? new Date(order.estimated_installation_date).getTime()
      : null;

    const installationDateError = getInstallationDateError(
      inspection_date !== undefined ? inspection_date : order.inspection_date,
      estimated_installation_date !== undefined ? estimated_installation_date : order.estimated_installation_date,
    );
    if (installationDateError) {
      return res.status(400).json({ success: false, message: installationDateError });
    }

    const nextInspectionDate = inspection_date !== undefined ? inspection_date : order.inspection_date;
    const nextItems = Array.isArray(updateData.items) ? updateData.items : order.items || [];
    const requestedRushCharges = countSelectedRushItems(nextItems);
    if (requestedRushCharges > 2) {
      return res.status(400).json({ success: false, code: "RUSH_CHARGE_ORDER_LIMIT", message: "An order can include a maximum of 2 Rush charges." });
    }
    const requestedRushOrders = requestedRushCharges > 0 ? 1 : 0;
    if (typeof is_rush_order === "boolean") updateData.is_rush_order = is_rush_order;
    if (requestedRushOrders > 0 && !nextInspectionDate) {
      return res.status(400).json({ success: false, message: "A scheduled inspection date is required for a Rush Order." });
    }
    if (requestedRushOrders > 0) {
      const rushOrderCount = await countRushOrdersOnDate(nextInspectionDate, order._id);
      if (rushOrderCount + requestedRushOrders > RUSH_ORDER_DAILY_LIMIT) {
        const requestedTotal = rushOrderCount + requestedRushOrders;
        return res.status(409).json({
          success: false,
          code: "RUSH_ORDER_DAILY_LIMIT",
          message: `This order would use ${requestedTotal} Rush Order slots on the selected date. The daily maximum is ${RUSH_ORDER_DAILY_LIMIT}.`,
          rush_order_count: rushOrderCount,
          requested_rush_order_count: requestedRushOrders,
          rush_order_limit: RUSH_ORDER_DAILY_LIMIT,
        });
      }
    }

    const registeredCustomer = order.customer?._id ? order.customer : null;
    if (registeredCustomer) {
      const registeredName = `${registeredCustomer.first_name || ""} ${registeredCustomer.last_name || ""}`.trim();
      updateData.customer_name = registeredName || order.customer_name || "";
      updateData.customer_email = registeredCustomer.email || "";
      updateData.customer_phone = registeredCustomer.phone || "";
      updateData.has_account_on_website = true;
    }

    if (Array.isArray(updateData.items)) {
      updateData.items = updateData.items.map((item, index) => {
        const existingItem = getExistingItemForRequest(items[index], index);
        const itemProductId = String(item.product_id?._id || item.product_id || "");
        const existingProductId = String(existingItem?.product_id?._id || existingItem?.product_id || "");
        const sameProduct = Boolean(existingItem && itemProductId === existingProductId);
        return {
          ...item,
          progress: existingItem?.progress ?? null,
          progress_stages: existingItem?.progress_stages || [],
          warranty_start_date: sameProduct ? existingItem.warranty_start_date || null : null,
          warranty_expiry_date: sameProduct ? existingItem.warranty_expiry_date || null : null,
          warranty_status: sameProduct && existingItem.warranty_status
            ? existingItem.warranty_status
            : item.warranty_period === "No Warranty" ? "no_warranty" : "pending",
        };
      });
    }

    const wasDownpaymentReceived = Boolean(order.downpayment_received);
    const currentItems = Array.isArray(updateData.items) ? updateData.items : order.items || [];
    const calculatedItemsEstimate = currentItems.reduce((sum, item) => sum + getItemAmountValue(item), 0);
    const previousItemsEstimate = (order.items || []).reduce((sum, item) => sum + getItemAmountValue(item), 0);
    if (Array.isArray(updateData.items) && !(calculatedItemsEstimate > 0)) {
      return res.status(400).json({ success: false, message: "Inspection items must have valid configured prices." });
    }
    const nextProjectCharges = Array.isArray(updateData.project_additional_charges) ? updateData.project_additional_charges : order.project_additional_charges || [];
    const projectChargesTotal = getProjectChargesTotal(nextProjectCharges);
    const previousProjectChargesTotal = getProjectChargesTotal(order.project_additional_charges);
    const previousItemsProjectCost = Math.round((previousItemsEstimate + previousProjectChargesTotal) * 100) / 100;
    const previousEstimatedCost = Math.max(
      Number(order.estimated_cost) > 0 ? Number(order.estimated_cost) : 0,
      previousItemsProjectCost,
    );
    const savedBaseProjectCost = getBaseProjectCost(order);
    const previousBaseProjectCost = Number(order.manual_override) > 0
      ? savedBaseProjectCost
      : Math.max(savedBaseProjectCost, previousEstimatedCost);
    const itemAmountDelta = Array.isArray(updateData.items)
      ? calculatedItemsEstimate - previousItemsEstimate
      : 0;
    const projectChargesDelta = Array.isArray(updateData.project_additional_charges)
      ? projectChargesTotal - previousProjectChargesTotal
      : 0;
    const pricingDelta = Math.round((itemAmountDelta + projectChargesDelta) * 100) / 100;
    const updatedManualOverride = manual_override !== undefined
      ? Math.max(Number(manual_override) || 0, 0)
      : Math.max(Number(order.manual_override) || 0, 0);
    let updatedEstimatedCost;
    if (pricingInputsUnchanged) {
      updatedEstimatedCost = previousEstimatedCost;
    } else if (Number(order.manual_override) > 0 && manual_override !== undefined && updatedManualOverride === 0) {
      updatedEstimatedCost = calculatedItemsEstimate + projectChargesTotal;
    } else if (Array.isArray(updateData.items) || Array.isArray(updateData.project_additional_charges)) {
      updatedEstimatedCost = Math.round(Math.max(0, previousEstimatedCost + pricingDelta) * 100) / 100;
    } else {
      updatedEstimatedCost = previousEstimatedCost;
    }
    let updatedTotalAmount;
    if (pricingInputsUnchanged) {
      updatedTotalAmount = previousBaseProjectCost;
    } else if (updatedManualOverride > 0) {
      updatedTotalAmount = updatedManualOverride;
    } else if (Number(order.manual_override) > 0 && manual_override !== undefined) {
      updatedTotalAmount = updatedEstimatedCost;
    } else {
      const adjustedBaseCost = Math.round((previousBaseProjectCost + pricingDelta) * 100) / 100;
      updatedTotalAmount = adjustedBaseCost > 0 ? adjustedBaseCost : updatedEstimatedCost;
    }
    const updatedPaymentTerms = payment_terms !== undefined ? payment_terms : order.payment_terms;
    const configuredRequiredAmount = required_downpayment_amount !== undefined
      ? required_downpayment_amount
      : order.required_downpayment_amount ?? order.downpayment_amount;
    const updatedRequiredAmount = calculateRequiredDownpayment(
      updatedTotalAmount,
      updatedPaymentTerms,
      configuredRequiredAmount,
    );
    const currentEstimatedCost = Number(order.estimated_cost) || (order.items || []).reduce((sum, item) => sum + getItemAmountValue(item), 0);
    const currentRequiredAmount = Number(order.required_downpayment_amount ?? order.downpayment_amount) || 0;
    const amountChanged = Math.round(updatedTotalAmount * 100) !== Math.round(getBaseProjectCost(order) * 100)
      || Math.round(updatedEstimatedCost * 100) !== Math.round(currentEstimatedCost * 100)
      || Math.round(updatedRequiredAmount * 100) !== Math.round(currentRequiredAmount * 100);
    if (isProjectPriceLocked(order) && amountChanged) {
      return res.status(409).json({
        success: false,
        message: "This project's price is locked because its contract was accepted or a payment was recorded. Use the contract amendment and approval workflow before changing its price.",
      });
    }
    const optionalChargeChanges = [];
    if (Array.isArray(updateData.items)) {
      currentItems.forEach((item, itemIndex) => {
        const previousItem = order.items?.[itemIndex];
        const previousCharges = (previousItem?.extra_charges || []).filter((charge) => charge?.is_optional === true);
        const nextCharges = (item.extra_charges || []).filter((charge) => charge?.is_optional === true);
        const getChargeKey = (charge, index) => String(charge?._id || charge?.name || `charge-${index}`);
        const previousByKey = new Map(previousCharges.map((charge, index) => [getChargeKey(charge, index), charge]));
        const nextByKey = new Map(nextCharges.map((charge, index) => [getChargeKey(charge, index), charge]));
        const keys = new Set([...previousByKey.keys(), ...nextByKey.keys()]);
        keys.forEach((key) => {
          const previous = previousByKey.get(key);
          const next = nextByKey.get(key);
          const before = { selected: previous?.is_selected === true, amount: Number(previous?.amount) || 0 };
          const after = { selected: next?.is_selected === true, amount: Number(next?.amount) || 0 };
          if (before.selected !== after.selected || before.amount !== after.amount) {
            optionalChargeChanges.push({
              product: item.name || previousItem?.name || "Product",
              charge: next?.name || previous?.name || "Optional charge",
              before,
              after,
            });
          }
        });
      });
    }
    updateData.manual_override = updatedManualOverride;
    updateData.estimated_cost = updatedEstimatedCost;
    updateData.final_project_cost = updatedTotalAmount;
    updateData.total_amount = updatedTotalAmount;
    updateData.contract_amount = updatedTotalAmount;
    updateData.downpayment_amount = updatedRequiredAmount;
    updateData.required_downpayment_amount = updatedRequiredAmount;

    const previousProjectTotal = getFinalProjectCost(order);
    Object.assign(order, updateData);
    if (estimated_installation_date !== undefined) {
      const nextInstallationDate = order.estimated_installation_date
        ? new Date(order.estimated_installation_date).getTime()
        : null;
      if (nextInstallationDate !== previousInstallationDate) {
        const resolvedAt = new Date();
        if (clearGeneratedRescheduleDelay(order.progress_stages, resolvedAt)) order.markModified("progress_stages");
        (order.items || []).forEach((item, itemIndex) => {
          if (clearGeneratedRescheduleDelay(item.progress_stages, resolvedAt)) order.markModified(`items.${itemIndex}.progress_stages`);
        });
      }
    }
    if (optionalChargeChanges.length > 0) {
      const actor = req.user || {};
      order.price_change_history = order.price_change_history || [];
      order.price_change_history.push({
        changed_at: new Date(),
        changed_by: actor.id || actor._id || null,
        changed_by_name: [actor.first_name, actor.last_name].filter(Boolean).join(" "),
        reason: "Optional charges updated during site inspection",
        previous_total: previousProjectTotal,
        new_total: updatedTotalAmount + Math.max(Number(order.installation_extra_charge_total) || 0, 0),
        optional_charge_changes: optionalChargeChanges,
      });
    }
    if (downpayment_received === true && !wasDownpaymentReceived && (Number(order.amount_paid) || 0) < updatedRequiredAmount) {
      order.amount_paid = updatedRequiredAmount;
    }
    if (order.amount_paid === undefined && order.downpayment_received) {
      order.amount_paid = updatedRequiredAmount;
    }
    const { requiredAmount, paidAmount } = getOrderPaymentAmounts(order);
    order.downpayment_received = requiredAmount > 0 && paidAmount >= requiredAmount;
    order.payment_status = getOrderPaymentStatus(order);
    await saveWithScheduleReservations(order, {
      inspection_date: order.inspection_date,
      inspection_time: order.inspection_time,
      inspection_duration_minutes: order.inspection_duration_minutes,
      inspection_travel_minutes: order.inspection_travel_minutes,
      estimated_installation_date: order.estimated_installation_date,
      estimated_installation_time: order.estimated_installation_time,
      installation_duration_minutes: order.installation_duration_minutes,
    }, () => order.save(), previousSchedule);

    res.json({ success: true, order: attachOrderScheduleOverdue(order) });
    const currentInstallationDate = order.estimated_installation_date
      ? new Date(order.estimated_installation_date).getTime()
      : null;
    if (estimated_installation_date !== undefined && currentInstallationDate && currentInstallationDate !== previousInstallationDate) {
      const plan = getInstallationPlan(order);
      void sendOrderNotification("installation_date", order, {
        installationDate: order.estimated_installation_date,
        installationTime: plan.time,
        installationStatus: plan.status,
      });
    }
  } catch (error) {
    console.error("Update inspection payload:", JSON.stringify(req.body, null, 2));
    console.error("Update inspection data:", JSON.stringify(updateData, null, 2));
    console.error("Update inspection error name:", error.name);
    console.error("Update inspection error:", error);
    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Inspection update failed validation",
        details: error.name === "ValidationError"
          ? Object.values(error.errors).map((err) => err.message)
          : [error.message],
      });
    }
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Unable to update inspection",
      error: error.name,
      details: error.stack || error.errors || null,
    });
  }
};

const getProgressActor = (user = {}) => ({
  id: user._id || user.id || null,
  name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.name || user.email || "Staff",
  role: user.role || "staff",
});

export const updateProjectDelay = async (req, res) => {
  try {
    if (! ["admin", "super_admin"].includes(req.user?.role)) return res.status(403).json({ success: false, message: "Administrator access required." });
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    if (String(order.status || "").toLowerCase() === "cancelled") return res.status(409).json({ success: false, message: "Cancelled projects are read-only." });
    const actor = getProgressActor(req.user);
    const delay = order.project_delay || { is_delayed: false, history: [] };
    const history = Array.isArray(delay.history) ? delay.history : [];
    const action = req.body.action;
    const requestId = String(req.body.requestId || "").slice(0, 100);
    if (requestId && history.some((entry) => entry.requestId === requestId || entry.resolutionRequestId === requestId)) return res.json({ success: true, order, duplicate: true });
    const allStages = [ ...(order.progress_stages || []), ...(order.items || []).flatMap((item) => item.progress_stages || []) ];
    const isComplete = String(order.status || "").toLowerCase() === "completed" || (allStages.length > 0 && allStages.every((stage) => Boolean(stage.completed) || ["done", "completed"].includes(String(stage.status || "").toLowerCase())));
    const now = new Date();
    if (action === "mark_delayed") {
      if (isComplete) return res.status(409).json({ success: false, message: "A completed project cannot be marked as delayed." });
      if (delay.is_delayed) return res.status(409).json({ success: false, message: "This project already has an active delay." });
      const reason = String(req.body.reason || "").trim();
      if (!reason) return res.status(400).json({ success: false, message: "Enter a reason for the delay." });
      if (reason.length > 2000) return res.status(400).json({ success: false, message: "Delay reason must be 2,000 characters or fewer." });
      const proposedDate = req.body.proposedRevisedDate ? new Date(req.body.proposedRevisedDate) : null;
      if (proposedDate && Number.isNaN(proposedDate.getTime())) return res.status(400).json({ success: false, message: "Enter a valid proposed date." });
      const entry = { id: new mongoose.Types.ObjectId().toString(), requestId, action, reason, proposedRevisedDate: proposedDate, status: "active", at: now, by: actor.id, byName: actor.name, byRole: actor.role, emailStatus: "queued" };
      order.project_delay = { ...delay, is_delayed: true, reason, proposed_revised_installation_date: proposedDate, reportedAt: now, reportedBy: actor.id, reportedByName: actor.name, reportedByRole: actor.role, history: [...history, entry] };
      order.markModified("project_delay");
      order.progress_audit = [...(order.progress_audit || []), { type: "project_marked_delayed", at: now, by: actor.id, byName: actor.name, byRole: actor.role, reason, proposedRevisedDate: proposedDate }].slice(-500);
      await order.save();
      let emailResult = { sent: false };
      try { emailResult = await sendOrderNotification("project_delay", order, { reason, proposedDate, requestId }); }
      catch (notificationError) { console.error("Project delay email notification failed:", notificationError); }
      const savedHistory = [...(order.project_delay?.history || [])];
      const deliveryStatus = emailResult.sent ? "sent" : emailResult.failed ? "failed" : "missing_recipient";
      if (savedHistory.length) savedHistory[savedHistory.length - 1] = { ...savedHistory.at(-1), emailStatus: deliveryStatus, emailAttemptedAt: new Date() };
      order.project_delay = { ...order.project_delay, history: savedHistory };
      order.markModified("project_delay");
      await order.save();
      return res.json({ success: true, order });
    }
    if (action === "resolve_delay") {
      if (!delay.is_delayed) return res.status(409).json({ success: false, message: "This project does not have an active delay." });
      const currentEntryIndex = history.map((entry) => entry.status === "active").lastIndexOf(true);
      if (currentEntryIndex >= 0) history[currentEntryIndex] = { ...history[currentEntryIndex], status: "resolved", resolutionRequestId: requestId, resolvedAt: now, resolvedBy: actor.id, resolvedByName: actor.name, resolvedByRole: actor.role };
      order.project_delay = { ...delay, is_delayed: false, reason: "", proposed_revised_installation_date: null, resolvedAt: now, resolvedBy: actor.id, resolvedByName: actor.name, history };
      order.markModified("project_delay");
      order.progress_audit = [...(order.progress_audit || []), { type: "project_delay_resolved", at: now, by: actor.id, byName: actor.name, byRole: actor.role }].slice(-500);
      await order.save();
      let emailResult = { sent: false };
      try { emailResult = await sendOrderNotification("project_delay_resolved", order, { requestId }); }
      catch (notificationError) { console.error("Project delay resolution email failed:", notificationError); }
      order.project_delay = { ...order.project_delay, resolutionEmailStatus: emailResult.sent ? "sent" : emailResult.failed ? "failed" : "missing_recipient", resolutionEmailAttemptedAt: new Date() };
      order.markModified("project_delay");
      await order.save();
      return res.json({ success: true, order });
    }
    return res.status(400).json({ success: false, message: "Unsupported delay action." });
  } catch (error) {
    console.error("Failed to update project delay:", error);
    return res.status(500).json({ success: false, message: "Unable to update the project delay." });
  }
};

export const updateProtectedProjectNotes = async (req, res) => {
  try {
    if (!["admin", "super_admin"].includes(req.user?.role)) return res.status(403).json({ success: false, message: "Only authorized administrators can edit protected project notes." });
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    if (String(order.status || "").toLowerCase() === "cancelled") return res.status(409).json({ success: false, message: "Cancelled projects are read-only." });
    const content = String(req.body.content || "").trim();
    if (content.length > 4000) return res.status(400).json({ success: false, message: "Protected notes must be 4,000 characters or fewer." });
    const actor = getProgressActor(req.user);
    const now = new Date();
    const previous = order.protected_project_notes || {};
    order.protected_project_notes = { content, authorId: previous.authorId || actor.id, authorName: previous.authorName || actor.name, authorRole: previous.authorRole || actor.role, createdAt: previous.createdAt || now, updatedAt: now, updatedBy: actor.id, updatedByName: actor.name, updatedByRole: actor.role };
    order.progress_audit = [...(order.progress_audit || []), { type: "protected_project_notes_updated", at: now, by: actor.id, byName: actor.name, byRole: actor.role, previousContent: String(previous.content || ""), updatedContent: content }].slice(-500);
    order.markModified("protected_project_notes");
    await order.save();
    return res.json({ success: true, order });
  } catch (error) {
    console.error("Failed to update protected project notes:", error);
    return res.status(500).json({ success: false, message: "Unable to save protected project notes." });
  }
};

export const addProgressActivityNote = async (req, res) => {
  try {
    if (!["admin", "super_admin", "skilled_worker"].includes(req.user?.role)) return res.status(403).json({ success: false, message: "Staff access required." });
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    if (String(order.status || "").toLowerCase() === "cancelled") return res.status(409).json({ success: false, message: "Cancelled projects are read-only." });
    const content = String(req.body.content || "").trim();
    if (!content) return res.status(400).json({ success: false, message: "Enter a note before saving." });
    if (content.length > 2000) return res.status(400).json({ success: false, message: "Activity notes must be 2,000 characters or fewer." });
    const requestId = String(req.body.requestId || "").slice(0, 100);
    const notes = order.progress_activity_notes || [];
    if (requestId && notes.some((note) => note.requestId === requestId)) return res.json({ success: true, order, duplicate: true });
    const actor = getProgressActor(req.user);
    const note = { id: new mongoose.Types.ObjectId().toString(), requestId, content, authorId: actor.id, authorName: actor.name, authorRole: actor.role, createdAt: new Date() };
    order.progress_activity_notes = [...notes, note].slice(-1000);
    order.progress_audit = [...(order.progress_audit || []), { type: "activity_note_added", at: note.createdAt, by: actor.id, byName: actor.name, byRole: actor.role, noteId: note.id }].slice(-500);
    order.markModified("progress_activity_notes");
    await order.save();
    return res.json({ success: true, order, note });
  } catch (error) {
    console.error("Failed to add progress activity note:", error);
    return res.status(500).json({ success: false, message: "Unable to add the activity note." });
  }
};

export const updateOrderProgress = async (req, res) => {
  try {
    if (!["admin", "super_admin", "skilled_worker"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Staff access required" });
    }

    const { orderId } = req.params;
    const { progress, status, installation_date, estimated_installation_date, estimated_installation_time, stages, proof_images } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (String(order.status || "").toLowerCase() === "cancelled") return res.status(409).json({ success: false, message: "Cancelled projects cannot receive further progress updates." });

    const previousSchedule = {
      inspection_date: order.inspection_date, inspection_time: order.inspection_time,
      inspection_duration_minutes: order.inspection_duration_minutes, inspection_travel_minutes: order.inspection_travel_minutes,
      estimated_installation_date: order.estimated_installation_date, estimated_installation_time: order.estimated_installation_time,
      installation_duration_minutes: order.installation_duration_minutes,
    };

    const previousInstallationPlan = getInstallationPlan(order);
    const itemIndex = req.body.itemIndex;
    const isItemProgressUpdate = typeof itemIndex === "number" && Number.isInteger(itemIndex) && order.items.length > 1;
    if (estimated_installation_date) {
      const installationDateError = getInstallationDateError(order.inspection_date, estimated_installation_date);
      if (installationDateError) {
        return res.status(400).json({ success: false, message: installationDateError });
      }
      const proposedTime = estimated_installation_time ?? order.estimated_installation_time;
      if (!proposedTime) return res.status(400).json({ success: false, message: "Choose an installation start time." });
      const scheduleError = await validateOrderSchedules({
        inspection_date: order.inspection_date,
        inspection_time: order.inspection_time,
        inspection_duration_minutes: order.inspection_duration_minutes,
        inspection_travel_minutes: order.inspection_travel_minutes,
        estimated_installation_date,
        estimated_installation_time: proposedTime,
        installation_duration_minutes: order.installation_duration_minutes,
      }, order._id, previousSchedule);
      if (scheduleError) return res.status(409).json({ success: false, code: "SCHEDULE_UNAVAILABLE", message: scheduleError });
    }
    if (itemIndex !== undefined && (!isItemProgressUpdate || itemIndex < 0 || itemIndex >= order.items.length)) {
      return res.status(400).json({ success: false, message: "Invalid item index for batch progress update." });
    }
    const previousStages = isItemProgressUpdate && order.items[itemIndex].progress_stages?.length
      ? order.items[itemIndex].progress_stages
      : order.progress_stages || [];
    if (req.user.role === "skilled_worker") {
      const staffActions = req.staffAccess?.modules?.progress_monitoring;
      const allowed = (action) => staffActions?.enabled === true && staffActions.actions?.[action] === true;
      const hasRemovedPhoto = (before = [], after = []) => before.some((photo) => !after.includes(photo));
      const hasAddedPhoto = (before = [], after = []) => after.some((photo) => !before.includes(photo));
      let removesProof = false;
      let addsProof = Array.isArray(proof_images) && proof_images.length > 0;
      if (Array.isArray(stages)) {
        stages.forEach((stage, index) => {
          const prior = previousStages.find((entry, priorIndex) => String(entry.key || entry.name || priorIndex) === String(stage.key || stage.name || index));
          removesProof ||= hasRemovedPhoto(prior?.images, stage.images);
          addsProof ||= hasAddedPhoto(prior?.images, stage.images);
          (stage.subStages || []).forEach((sub) => {
            const priorSub = (prior?.subStages || []).find((entry) => entry.name === sub.name);
            removesProof ||= hasRemovedPhoto(priorSub?.images, sub.images);
            addsProof ||= hasAddedPhoto(priorSub?.images, sub.images);
          });
        });
      }
      if (removesProof && !allowed("delete_proof")) return res.status(403).json({ success: false, message: "Deleting progress proof is disabled for your account." });
      if (addsProof && !allowed("upload_progress_photo")) return res.status(403).json({ success: false, message: "Uploading progress photos is disabled for your account." });
    }
    if (req.body.expectedUpdatedAt && order.updatedAt
      && new Date(req.body.expectedUpdatedAt).getTime() !== new Date(order.updatedAt).getTime()) {
      return res.status(409).json({ success: false, message: "This project was updated by someone else. Reload it and review the latest progress before saving." });
    }
    const auditTarget = isItemProgressUpdate ? order.items[itemIndex] : order;
    const auditEvents = [];
    const actor = req.user || {};
    const actorName = [actor.first_name, actor.last_name].filter(Boolean).join(" ") || actor.name || actor.email || "Staff";
    const progressCooldownMs = 5 * 60 * 1000;
    const progressRequestTime = new Date();
    const newlyCompletedTargets = [];
    const latestSavedCompletion = previousStages.flatMap((stage) => [
      stage.completedAt,
      ...(stage.subStages || []).map((sub) => sub.completedAt),
    ]).map((value) => value ? new Date(value).getTime() : 0).filter(Number.isFinite).reduce((latest, value) => Math.max(latest, value), 0);
    const cooldownRemainingMs = latestSavedCompletion
      ? Math.max(0, progressCooldownMs - (progressRequestTime.getTime() - latestSavedCompletion))
      : 0;
    // Notes are managed by dedicated permission-checked endpoints.
    if (Array.isArray(stages)) {
      const wasDone = (stage) => Boolean(stage?.completed) || ["done", "completed"].includes(String(stage?.status || "").toLowerCase());
      const sameDate = (first, second) => (!first && !second) || (Boolean(first) && Boolean(second) && new Date(first).getTime() === new Date(second).getTime());
      const sameList = (first, second) => JSON.stringify(first || []) === JSON.stringify(second || []);
      const oldByIdentity = new Map(previousStages.map((stage, index) => [String(stage.key || stage.name || index), stage]));
      const nextIdentities = new Set(stages.map((stage, index) => String(stage.key || stage.name || index)));
      for (const [index, priorStage] of previousStages.entries()) {
        const identity = String(priorStage.key || priorStage.name || index);
        if (wasDone(priorStage) && !nextIdentities.has(identity)) {
          return res.status(409).json({ success: false, message: "Completed stages cannot be removed through normal progress updates." });
        }
        const nextStage = stages.find((stage, nextIndex) => String(stage.key || stage.name || nextIndex) === identity);
        if (nextStage && (priorStage.subStages || []).some((priorSub) => wasDone(priorSub) && !(nextStage.subStages || []).some((nextSub) => nextSub.name === priorSub.name))) {
          return res.status(409).json({ success: false, message: "Completed sub-stages cannot be removed through normal progress updates." });
        }
      }
      for (const [index, nextStage] of stages.entries()) {
        const identity = String(nextStage.key || nextStage.name || index);
        const prior = oldByIdentity.get(identity);
        const nowDone = wasDone(nextStage);
        if (nowDone && !wasDone(prior)) newlyCompletedTargets.push({ type: "stage", name: nextStage.name || "Stage" });
        if (wasDone(prior) && nowDone && (
          !sameDate(prior.date, nextStage.date) ||
          String(prior.completionNote || "") !== String(nextStage.completionNote || "") ||
          !sameList(prior.images, nextStage.images)
        )) return res.status(409).json({ success: false, message: "Saved completion dates, notes, and proof photos are locked." });
        if (nowDone && !wasDone(prior)) {
          const earlierIncomplete = previousStages.slice(0, index).find((stage) => !wasDone(stage));
          if (earlierIncomplete) {
            return res.status(409).json({ success: false, message: `Complete ${earlierIncomplete.name || "the previous stage"} before completing ${nextStage.name || "this stage"}.` });
          }
          const incompleteSub = (nextStage.subStages || []).find((sub) => !wasDone(sub));
          if (incompleteSub) return res.status(409).json({ success: false, message: `Complete all sub-stages before completing ${nextStage.name || "this stage"}.` });
          for (const sub of nextStage.subStages || []) {
            const previousSub = (prior?.subStages || []).find((entry) => entry.name === sub.name);
            if (wasDone(sub) && !wasDone(previousSub) && !(sub.images || []).length) {
              return res.status(400).json({ success: false, message: `Add proof photos before completing ${sub.name || "the sub-stage"}.` });
            }
          }
          auditEvents.push({ type: "stage_completed", stageKey: identity, stageName: nextStage.name || "Stage", note: nextStage.completionNote || "", at: new Date(), by: actor._id || null, byName: actorName });
        }
        if (!nowDone && wasDone(prior)) {
          return res.status(409).json({ success: false, message: "Completed stages cannot be reverted through normal progress updates." });
        }
        const priorSubs = new Map((prior?.subStages || []).map((sub) => [sub.name, sub]));
        for (const sub of nextStage.subStages || []) {
          const previousSub = priorSubs.get(sub.name);
          if (wasDone(previousSub) && wasDone(sub) && (
            !sameDate(previousSub.date, sub.date) ||
            String(previousSub.completionNote || "") !== String(sub.completionNote || "") ||
            !sameList(previousSub.images, sub.images)
          )) return res.status(409).json({ success: false, message: "Saved sub-stage completion dates, notes, and proof photos are locked." });
          if (wasDone(sub) && !wasDone(previousSub)) {
            newlyCompletedTargets.push({ type: "sub-stage", name: sub.name || "Sub-stage" });
            if (!(sub.images || []).length) return res.status(400).json({ success: false, message: `Add proof photos before completing ${sub.name || "the sub-stage"}.` });
            auditEvents.push({ type: "substage_completed", stageKey: identity, stageName: nextStage.name || "Stage", subStageName: sub.name || "Sub-stage", note: sub.completionNote || "", at: new Date(), by: actor._id || null, byName: actorName });
          }
          if (!wasDone(sub) && wasDone(previousSub)) {
            return res.status(409).json({ success: false, message: "Completed sub-stages cannot be reverted through normal progress updates." });
          }
        }
      }
      if (newlyCompletedTargets.length > 1) {
        return res.status(409).json({ success: false, code: "PROGRESS_COOLDOWN", message: "Complete and save one progress stage or sub-stage at a time before proceeding." });
      }
      if (newlyCompletedTargets.length === 1) {
        if (cooldownRemainingMs > 0) {
          return res.status(409).json({
            success: false,
            code: "PROGRESS_COOLDOWN",
            message: "Please wait 5 minutes before proceeding to the next progress stage.",
            retryAt: new Date(latestSavedCompletion + progressCooldownMs).toISOString(),
            remainingMs: cooldownRemainingMs,
          });
        }
      }
    }
    const previousDelayEventKeys = new Set(previousStages.flatMap((stage, index) =>
      (stage.delayHistory || []).map((entry) => getDelayEventKey(stage, entry, index))
    ));
    let newDelayEvents = [];

    if (typeof progress !== "undefined") {
      if (isItemProgressUpdate) order.items[itemIndex].progress = Number(progress) || 0;
      else order.progress = Number(progress) || 0;
    }

    // Map friendly status values back to internal statuses when possible
    const mapFriendlyToInternal = (s) => {
      if (!s) return undefined;
      const key = String(s).toLowerCase();
      if (key.includes("fabrication") || key.includes("processing")) return "processing";
      if (key.includes("installation") || key.includes("site_inspection")) return "site_inspection";
      if (key.includes("cutting")) return "processing";
      if (key.includes("pending")) return "admin_review";
      if (key.includes("delayed")) return "processing";
      return undefined;
    };

    const mapped = isItemProgressUpdate || Array.isArray(stages) ? undefined : mapFriendlyToInternal(status);
    if (mapped) order.status = mapped;

    if (!isItemProgressUpdate && installation_date) {
      // store as inspection_date for compatibility with existing schema
      order.inspection_date = installation_date;
    }

    if (!isItemProgressUpdate && estimated_installation_date !== undefined) {
      const parsedInstallationDate = estimated_installation_date ? new Date(estimated_installation_date) : null;
      if (parsedInstallationDate && Number.isNaN(parsedInstallationDate.getTime())) {
        return res.status(400).json({ success: false, message: "Estimated installation date must be a valid date." });
      }
      order.estimated_installation_date = parsedInstallationDate;
    }
    if (!isItemProgressUpdate && estimated_installation_time !== undefined) order.estimated_installation_time = String(estimated_installation_time || "");

    if (Array.isArray(stages)) {
      const previousStagesByIdentity = new Map(previousStages.map((stage, index) => [String(stage.key || stage.name || index), stage]));
      const isProgressUnitDone = (unit) => Boolean(unit?.completed) || ["done", "completed"].includes(String(unit?.status || "").toLowerCase());
      const normalizedStages = stages.map((s, stageIndex) => {
        const identity = String(s.key || s.name || stageIndex);
        const priorStage = previousStagesByIdentity.get(identity);
        const stageCompleted = isProgressUnitDone(s);
        return ({
        key: s.key || (s.name || "").toString().toLowerCase().replace(/\s+/g, "_"),
        name: s.name || "",
        status: ["pending", "in_progress", "done", "delayed", "on_hold"].includes(s.status) ? s.status : stageCompleted ? "done" : "pending",
        completed: stageCompleted,
        date: s.date ? new Date(s.date) : null,
        completedAt: stageCompleted ? priorStage?.completedAt || (!isProgressUnitDone(priorStage) ? progressRequestTime : null) : null,
        completionNote: String(s.completionNote || "").slice(0, 1000),
        delayReason: s.delayReason || "",
        delayExpectedResolution: s.delayExpectedResolution ? new Date(s.delayExpectedResolution) : null,
        delayNotes: s.delayNotes || "",
        delayReportedAt: s.delayReportedAt ? new Date(s.delayReportedAt) : null,
        delayReportedBy: s.delayReportedBy || "",
        installationStartedAt: s.installationStartedAt ? new Date(s.installationStartedAt) : null,
        installationCompletedAt: s.installationCompletedAt ? new Date(s.installationCompletedAt) : null,
        proposedInstallationDate: s.proposedInstallationDate ? new Date(s.proposedInstallationDate) : null,
        proposedInstallationTime: s.proposedInstallationTime ? String(s.proposedInstallationTime).trim() : "",
        delayHistory: Array.isArray(s.delayHistory)
          ? s.delayHistory.map((entry) => ({
              reason: entry.reason || "",
              expectedResolution: entry.expectedResolution ? new Date(entry.expectedResolution) : null,
              notes: entry.notes || "",
              reportedAt: entry.reportedAt ? new Date(entry.reportedAt) : null,
              reportedBy: entry.reportedBy || "",
              status: entry.status || "delayed",
              resolvedAt: entry.resolvedAt ? new Date(entry.resolvedAt) : null,
            }))
          : [],
        images: Array.isArray(s.images) ? s.images : [],
        customerResponse: ["pending", "accepted", "declined", "reschedule_requested"].includes(s.customerResponse)
          ? s.customerResponse
          : "pending",
        customerResponseAt: s.customerResponseAt ? new Date(s.customerResponseAt) : null,
        customerDeclineReason: s.customerDeclineReason ? s.customerDeclineReason : "",
        customerPreferredInstallationDate: s.customerPreferredInstallationDate ? new Date(s.customerPreferredInstallationDate) : null,
        customerPreferredInstallationTime: s.customerPreferredInstallationTime ? s.customerPreferredInstallationTime : "",
        customerRescheduleNotes: s.customerRescheduleNotes ? s.customerRescheduleNotes : "",
        subStages: Array.isArray(s.subStages)
          ? s.subStages.map((sub) => {
              const priorSubStage = (priorStage?.subStages || []).find((entry) => entry.name === sub.name);
              const subStageCompleted = isProgressUnitDone(sub);
              return ({
              name: sub.name || "",
              description: sub.description || "",
              status: ["pending", "in_progress", "done", "delayed", "on_hold"].includes(sub.status)
                ? sub.status
                : subStageCompleted
                ? "done"
                : "pending",
              completed: subStageCompleted,
              date: sub.date ? new Date(sub.date) : null,
              completedAt: subStageCompleted ? priorSubStage?.completedAt || (!isProgressUnitDone(priorSubStage) ? progressRequestTime : null) : null,
              completionNote: String(sub.completionNote || "").slice(0, 1000),
              images: Array.isArray(sub.images) ? sub.images : [],
              });
            })
          : [],
      });
      });

      const delayReporter = req.user?.email || "";
      let targetStages = normalizedStages.map((stage) => {
        const history = Array.isArray(stage.delayHistory)
          ? stage.delayHistory.map((entry) => ({
              ...entry,
              reportedBy: entry.reportedBy || delayReporter,
            }))
          : [];

        const last = history[history.length - 1];
        if (stage.status !== "delayed" && last && last.status === "delayed" && !last.resolvedAt) {
          history[history.length - 1] = {
            ...last,
            resolvedAt: new Date(),
          };
        }

        return {
          ...stage,
          delayReportedBy: stage.delayReportedBy || delayReporter,
          delayHistory: history,
        };
      });
      targetStages = applyInstallationNotificationTimestamps(previousStages, targetStages);

      const previousStageByIdentity = new Map(previousStages.map((stage, index) => [String(stage.key || stage.name || index), stage]));
      const newlyStartedTargets = [];
      targetStages.forEach((stage, stageIndex) => {
        const identity = String(stage.key || stage.name || stageIndex);
        const priorStage = previousStageByIdentity.get(identity);
        const wasInProgress = (unit) => ["in_progress", "in-progress", "active", "current"].includes(String(unit?.status || "").toLowerCase());
        if (wasInProgress(stage) && !wasInProgress(priorStage)) newlyStartedTargets.push(stage.name || "Stage");
        const priorSubStages = new Map((priorStage?.subStages || []).map((sub) => [sub.name, sub]));
        (stage.subStages || []).forEach((sub) => {
          if (wasInProgress(sub) && !wasInProgress(priorSubStages.get(sub.name))) newlyStartedTargets.push(sub.name || "Sub-stage");
        });
      });
      if (newlyStartedTargets.length > 1 || (newlyStartedTargets.length > 0 && newlyCompletedTargets.length > 0)) {
        return res.status(409).json({ success: false, code: "PROGRESS_COOLDOWN", message: "Complete and save one progress stage or sub-stage at a time before proceeding." });
      }
      if (newlyStartedTargets.length > 0 && cooldownRemainingMs > 0) {
        return res.status(409).json({
          success: false,
          code: "PROGRESS_COOLDOWN",
          message: "Please wait 5 minutes before proceeding to the next progress stage.",
          retryAt: new Date(latestSavedCompletion + progressCooldownMs).toISOString(),
          remainingMs: cooldownRemainingMs,
        });
      }

      const requestedInstallationDate = !isItemProgressUpdate && estimated_installation_date
        ? new Date(estimated_installation_date)
        : null;
      const previousPlannedDate = previousInstallationPlan.date
        ? new Date(previousInstallationPlan.date).getTime()
        : null;
      const isRescheduled = requestedInstallationDate && previousPlannedDate !== null
        && requestedInstallationDate.getTime() !== previousPlannedDate;
      const installationAlreadyCompleted = targetStages.some(isCompletedInstallationStage);
      if (isRescheduled && installationAlreadyCompleted) {
        return res.status(400).json({ success: false, message: "Installation cannot be rescheduled after it is completed." });
      }
      if (requestedInstallationDate && !installationAlreadyCompleted) {
        const scheduleStage = targetStages.find((stage) => {
          const key = String(stage.key || "").toLowerCase();
          const name = String(stage.name || "").toLowerCase();
          return key.includes("installation_scheduling") || name.includes("installation scheduling");
        }) || targetStages.find((stage) => {
          const key = String(stage.key || "").toLowerCase();
          const name = String(stage.name || "").toLowerCase();
          return !stage.completed && (key.includes("installation") || name.includes("installation"))
            && !key.includes("schedul") && !name.includes("schedul");
        });

        if (scheduleStage) {
          scheduleStage.proposedInstallationDate = requestedInstallationDate;
          scheduleStage.proposedInstallationTime = String(estimated_installation_time || order.estimated_installation_time || "");
          if (isRescheduled) clearGeneratedRescheduleDelay([scheduleStage]);
        }
      }

      newDelayEvents = targetStages.flatMap((stage, stageIndex) =>
        stage.delayHistory
          .filter((entry) => entry.status === "delayed" && !previousDelayEventKeys.has(getDelayEventKey(stage, entry, stageIndex)))
          .map((entry) => ({
            stageName: stage.name || stage.key || "Project stage",
            reason: entry.reason,
            expectedResolution: entry.expectedResolution,
            notes: entry.notes,
            productName: isItemProgressUpdate ? order.items[itemIndex]?.name : "",
          }))
      );

      if (isItemProgressUpdate) {
        const orderStages = Array.isArray(order.progress_stages) ? order.progress_stages : [];
        order.items.forEach((item) => {
          if (!Array.isArray(item.progress_stages) || item.progress_stages.length === 0) {
            item.progress_stages = orderStages.map((stage) => stage.toObject?.() || stage);
            item.progress = order.progress ?? null;
          }
        });
        order.items[itemIndex].progress_stages = targetStages;
        order.items[itemIndex].progress = Number(progress) || 0;

        const allBatchItemsCompleted = order.items.length > 0 && order.items.every((item) => {
          const itemStages = Array.isArray(item.progress_stages) ? item.progress_stages : [];
          return itemStages.length > 0 && itemStages.every(isProgressStageCompleted);
        });

        if (allBatchItemsCompleted) {
          order.progress = 100;
          order.status = "completed";
          order.progress_stages = (order.progress_stages || []).map((stage) => {
            const stageData = stage.toObject?.() || stage;
            return {
              ...stageData,
              status: "done",
              completed: true,
              subStages: Array.isArray(stageData.subStages)
                ? stageData.subStages.map((subStage) => ({ ...subStage, status: "done", completed: true }))
                : stageData.subStages,
            };
          });
        } else {
          const hasProductionProgress = order.items.some((item) =>
            (item.progress_stages || []).some((stage) =>
              stage.completed === true || !["", "pending"].includes(String(stage.status || "").toLowerCase())
            )
          );
          if (hasProductionProgress && order.status !== "cancelled") order.status = "processing";
          else if (order.status === "completed") order.status = order.contract_status === "accepted" ? "contract_accepted" : "admin_review";
        }
      } else {
        order.progress_stages = targetStages;
        const allProjectStagesDone =
          order.progress_stages.length > 0 &&
          order.progress_stages.every(isProgressStageCompleted);
        if (allProjectStagesDone) {
          order.status = "completed";
        } else {
          const hasProductionProgress = order.progress_stages.some((stage) =>
            stage.completed === true || !["", "pending"].includes(String(stage.status || "").toLowerCase())
          );
          if (hasProductionProgress && order.status !== "cancelled") order.status = "processing";
          else if (order.status === "completed") order.status = order.contract_status === "accepted" ? "contract_accepted" : "admin_review";
        }
      }

      // If a site inspection stage exists, keep inspection_date/status in sync
      if (!isItemProgressUpdate) {
        try {
        const inspectionStage = order.progress_stages.find((s) => {
          const key = (s.key || "").toString().toLowerCase();
          const name = (s.name || "").toString().toLowerCase();
          return (
            key.includes("site_inspection") ||
            name.includes("site inspection") ||
            key.includes("inspection") ||
            name.includes("inspection")
          );
        });

        if (inspectionStage) {
          // If admin saved a proposed date/time for inspection/scheduling, keep inspection_date in sync
          if (inspectionStage.proposedInstallationDate) {
            order.inspection_date = inspectionStage.proposedInstallationDate;
            // mark scheduled unless already completed
            if (order.inspection_status !== "completed") order.inspection_status = "scheduled";
          }

          // If the inspection stage is completed, ensure the order's inspection_status is marked completed
          if (inspectionStage.completed) {
            order.inspection_status = "completed";
            if (inspectionStage.date) {
              order.inspection_date = inspectionStage.date;
            }
          }
        }
      } catch (syncErr) {
        console.warn("Failed to sync inspection stage to order fields:", syncErr && syncErr.message ? syncErr.message : syncErr);
        }
      }
    }

    const warrantyStages = isItemProgressUpdate
      ? order.items[itemIndex]?.progress_stages || []
      : order.progress_stages || [];
    applyInstallationWarranty(order, warrantyStages, isItemProgressUpdate ? itemIndex : undefined);

    // Accept an array of proof_images to append to the last stage or attachments
    if (Array.isArray(proof_images) && proof_images.length > 0) {
      order.attachments = Array.isArray(order.attachments) ? order.attachments.concat(proof_images) : proof_images.slice();
      if (order.progress_stages && order.progress_stages.length > 0) {
        const last = order.progress_stages[order.progress_stages.length - 1];
        last.images = Array.isArray(last.images) ? last.images.concat(proof_images) : proof_images.slice();
      }
    }

    if (auditEvents.length) {
      auditTarget.progress_audit = [...(auditTarget.progress_audit || []), ...auditEvents].slice(-500);
      auditTarget.markModified?.("progress_audit");
    }

    await saveWithScheduleReservations(order, {
      inspection_date: order.inspection_date,
      inspection_time: order.inspection_time,
      inspection_duration_minutes: order.inspection_duration_minutes,
      inspection_travel_minutes: order.inspection_travel_minutes,
      estimated_installation_date: order.estimated_installation_date,
      estimated_installation_time: order.estimated_installation_time,
      installation_duration_minutes: order.installation_duration_minutes,
    }, () => order.save(), previousSchedule);

    const notificationStages = isItemProgressUpdate
      ? order.items[itemIndex]?.progress_stages || []
      : order.progress_stages || [];
    await persistInstallationNotifications(
      order,
      notificationStages,
      isItemProgressUpdate ? itemIndex : null,
      isItemProgressUpdate ? order.items[itemIndex]?.name || "" : ""
    );

    const currentInstallationPlan = getInstallationPlan(order);
    const previousPlanDate = previousInstallationPlan.date ? new Date(previousInstallationPlan.date).getTime() : null;
    const currentPlanDate = currentInstallationPlan.date ? new Date(currentInstallationPlan.date).getTime() : null;
    if (currentPlanDate && (previousPlanDate !== currentPlanDate || previousInstallationPlan.time !== currentInstallationPlan.time)) {
      void sendOrderNotification("installation_date", order, {
        installationDate: currentInstallationPlan.date,
        installationTime: currentInstallationPlan.time,
        installationStatus: currentInstallationPlan.status,
      });
    }

    if (newDelayEvents.length > 0) {
      const linkedCustomer = order.customer
        ? await getCurrentCustomerContact(order.customer?._id || order.customer)
        : null;
      const customerEmail = linkedCustomer?.email || order.customer_email || "";
      if (customerEmail) {
        await Promise.all(newDelayEvents.map(async (delayEvent) => {
          const expectedResolution = delayEvent.expectedResolution
            ? new Date(delayEvent.expectedResolution).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })
            : "Not yet determined";
          const projectName = delayEvent.productName || order.items?.[0]?.name || "your project";
          const delayEmail = buildCustomerEmailTemplate({
            title: "Project delay update",
            summary: `Hello ${order.customer_name || linkedCustomer?.first_name || ""}, there is a delay affecting ${projectName}.`,
            status: "Project Delay",
            orderId: order.tracking || order._id,
            fields: [
              ["Project", projectName],
              ["Stage", delayEvent.stageName],
              ["Reason", delayEvent.reason || "Not provided"],
              ["Expected resolution", expectedResolution],
              ...(delayEvent.notes ? [["Additional notes", delayEvent.notes]] : []),
            ],
            nextSteps: "Our team is working to resolve the delay and will keep you updated on your project.",
            actionUrl: buildFrontendUrl("/customer-dashboard", { tab: "orders", orderId: order._id }),
            actionLabel: "View project status",
          });

          try {
            await sendMail({
              to: customerEmail,
              subject: `Project delay update - ${order.tracking || "your order"}`,
              ...delayEmail,
            });
          } catch (mailError) {
            console.error("Customer project delay email failed:", mailError);
          }
        }));
      }
    }

    res.json({ success: true, order: attachOrderScheduleOverdue(order) });
  } catch (error) {
    console.error("Update order progress error:", error);
    if (error?.name === "VersionError") {
      return res.status(409).json({ success: false, message: "This project changed while you were saving. Reload it and review the latest progress." });
    }
    res.status(500).json({ success: false, message: "Unable to update order progress", error: error.message });
  }
};

export const generateContract = async (req, res) => {
  try {
    if (!["admin", "super_admin", "skilled_worker"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { orderId } = req.params;
    const { contract_terms, snapshot, regenerate = false } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (String(order.status || "").toLowerCase() === "cancelled") {
      return res.status(409).json({ success: false, message: "Cancelled projects cannot receive new contract approvals." });
    }

    const estimatedInstallationDate = order.estimated_installation_date
      ? new Date(order.estimated_installation_date)
      : null;
    const estimatedInstallationDateText = String(order.estimated_installation_date || "").slice(0, 10);
    const hasInvalidCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(estimatedInstallationDateText)
      && estimatedInstallationDate?.toISOString().slice(0, 10) !== estimatedInstallationDateText;
    if (!estimatedInstallationDate || Number.isNaN(estimatedInstallationDate.getTime()) || hasInvalidCalendarDate) {
      return res.status(400).json({
        success: false,
        message: "Set the Est. Install Date first before generating the contract.",
      });
    }

    const finalProjectCost = getFinalProjectCost(order);
    const requiredAmount = calculateRequiredDownpayment(
      finalProjectCost,
      order.payment_terms,
      order.required_downpayment_amount ?? order.downpayment_amount,
    );
    const contractSnapshot = {
      ...(snapshot || order.contractSnapshot || {}),
      projectCost: finalProjectCost,
      additionalCharges: (order.project_additional_charges || []).map((charge) => ({ name: charge.name || "Additional charge", amount: Number(charge.amount) || 0, note: charge.note || "" })),
      downpayment: requiredAmount,
    };

    const version = regenerate
      ? Number(order.currentContractVersion || order.contractVersion || 0) + 1
      : Number(order.currentContractVersion || order.contractVersion || 0) || 1;

    const nextContractId = order.contractId || `ACGC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const history = Array.isArray(order.contractHistory) ? order.contractHistory.map((entry) => ({
      ...entry,
      status: entry.status === "Current" ? "Superseded" : entry.status,
    })) : [];

    history.push({
      version,
      contractId: nextContractId,
      generatedAt: new Date(),
      status: "Current",
      snapshot: contractSnapshot,
    });

    order.contractGenerated = true;
    order.contractId = nextContractId;
    order.contractVersion = version;
    order.currentContractVersion = version;
    order.contractGeneratedAt = new Date();
    order.contractNeedsRegeneration = false;
    order.contractStatus = "Created";
    order.contractSnapshot = contractSnapshot;
    order.contractHistory = history;
    order.contract_status = "pending";
    order.contractSentAt = null;
    order.contract_email_status = "not_sent";
    order.contract_email_queued_at = null;
    order.contract_email_sent_at = null;
    order.contract_email_error = "";
    order.contract_terms = contract_terms || "";
    order.total_amount = finalProjectCost;
    order.final_project_cost = finalProjectCost;
    order.contract_amount = finalProjectCost;
    order.required_downpayment_amount = requiredAmount;
    order.downpayment_amount = requiredAmount;
    order.inspection_status = order.inspection_status || "pending";

    if (order.status === "contract_sent") {
      order.status = "site_inspection";
    }

    await order.save();

    res.json({ success: true, order });
  } catch (error) {
    console.error("Generate contract error:", error);
    res.status(500).json({ success: false, message: "Unable to generate contract", error: error.message });
  }
};

export const sendWalkInApprovalEmail = async (req, res) => {
  try {
    if (!["admin", "super_admin", "skilled_worker"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { orderId } = req.params;
    const { customerName, customerEmail, contractUrl, contractAttachment } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const linkedCustomer = order.customer
      ? await getCurrentCustomerContact(order.customer?._id || order.customer)
      : null;
    const customerEmailValue = (linkedCustomer?.email || customerEmail || order.customer_email || "").trim();
    const isWalkInCustomer = String(order.order_type || "") === "walk_in_customer";

    if (!customerEmailValue) {
      return res.status(400).json({ success: false, message: "Customer email is required" });
    }

    const generatedContractAttachment = getDataUrlAttachment(
      contractAttachment,
      `ACGC-Contract-${order.tracking || orderId}.pdf`
    );
    if (!generatedContractAttachment || generatedContractAttachment.contentType !== "application/pdf") {
      return res.status(400).json({
        success: false,
        message: "Generate the contract PDF before sending it to the customer.",
      });
    }

    const customerNameValue = customerName || order.customer_name || "Valued Customer";
    const orderIdentifier = order.tracking || order._id.toString();
    const contractLink = contractUrl || order.signed_contract_url || "";
    const fromAddress = process.env.EMAIL_FROM || "ACGC Site Inspection <no-reply@acgc.com>";
    const contractLoginLink = buildFrontendUrl("/customer-dashboard", { tab: "orders", orderId: order._id });

    const contractEmail = buildCustomerEmailTemplate({
      title: "Site inspection contract details",
      summary: `Hi ${customerNameValue}, your site inspection contract details are attached as a PDF file.`,
      status: "Site Inspection",
      orderId: orderIdentifier,
      fields: [["Contract document", `Attached PDF: ACGC-Contract-${orderIdentifier}.pdf`]],
      nextSteps: "Please review the attached document and contact our support team if anything needs to be corrected.",
      actionUrl: contractLoginLink,
      actionLabel: "Log in to view your contract",
      logoImageUrl: buildFrontendUrl("/ACGCLOGO1.png"),
    });

    const attachments = [...(contractEmail.attachments || []), generatedContractAttachment];
    const uploadedContractAttachment = getLocalUploadedAttachment(contractLink);
    if (uploadedContractAttachment) {
      attachments.push(uploadedContractAttachment);
    }

    const emailOptions = {
      from: fromAddress,
      to: customerEmailValue,
      subject: "ACGC Site Inspection Contract Details",
      ...contractEmail,
      attachments,
    };

    order.contract_status = "sent";
    order.contractStatus = "Sent";
    order.contractSentAt = new Date();
    order.contract_email_status = "queued";
    order.contract_email_queued_at = new Date();
    order.contract_email_sent_at = null;
    order.contract_email_error = "";
    order.status = "site_inspection";
    await order.save();

    res.once("finish", () => {
      setImmediate(async () => {
        try {
          await sendMail(emailOptions);
          await Order.updateOne(
            { _id: order._id },
            { $set: { contract_email_status: "sent", contract_email_sent_at: new Date(), contract_email_error: "" } }
          );
          console.info(`[contract-email] Delivered contract for order ${order.tracking || order._id}.`);
        } catch (emailError) {
          console.error("Approval email send failed:", emailError);
          const errorMessage = emailError?.code === "EAUTH"
            ? "Email service authentication failed."
            : "Unable to deliver email.";
          try {
            await Order.updateOne(
              { _id: order._id },
              { $set: { contract_email_status: "failed", contract_email_error: errorMessage } }
            );
          } catch (statusError) {
            console.error("Unable to record contract email failure:", statusError);
          }
        }
      });
    });

    return res.status(202).json({
      success: true,
      email_status: "queued",
      message: isWalkInCustomer
        ? "Contract saved to the customer account; approval email queued."
        : "Contract saved to the customer account; email queued.",
    });
  } catch (error) {
    console.error("Send approval email error:", error);
    res.status(500).json({ success: false, message: "Unable to send email", error: error.message });
  }
};
