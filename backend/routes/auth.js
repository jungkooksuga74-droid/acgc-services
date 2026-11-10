import express from "express";
import jwt from "jsonwebtoken";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import process from "node:process";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import multer from "multer";
import User from "../models/User.js";
import Admin from "../models/Admin.js";
import AdminRecoveryAttempt from "../models/AdminRecoveryAttempt.js";
import AdminRecoveryAudit from "../models/AdminRecoveryAudit.js";
import AdminRecoveryState from "../models/AdminRecoveryState.js";
import SystemSetting from "../models/SystemSetting.js";
import BackupOperationAudit from "../models/BackupOperationAudit.js";
import SuperAdminPromotionAudit from "../models/SuperAdminPromotionAudit.js";
import { getStreetAddressError, normalizeFullAddress } from "../utils/fullAddressValidation.js";
import { authMiddleware, roleMiddleware, staffModulePermission, staffModulePermissionIfStaff } from "../middleware/auth.js";
import { sendMail } from "../config/mailer.js";
import {
  getRecoveryRetryDelaySeconds,
  hashRecoveryIp,
  isValidAdminRecord,
  recoveryConfigurationIsValid,
  verifyRecoveryCredentials,
} from "../services/adminRecoverySecurity.js";
import {
  createSystemBackup,
  deleteSystemBackup,
  getSystemBackupDownload,
  getNextScheduledBackupAt,
  hydrateBackupHistorySizes,
  importSystemBackup,
  importSystemBackupFromCloudinary,
  runScheduledBackup,
  restoreSystemBackup,
} from "../services/backupService.js";
import {
  hashBackupRecoveryPassword,
  validateBackupRecoveryPassword,
  verifyBackupRecoveryPassword,
} from "../services/backupRecoverySecurity.js";
import { buildFrontendUrl } from "../services/frontendUrl.js";
import { getAdminPublicContact } from "../services/businessContact.js";
import { buildCustomerEmailTemplate } from "../services/customerEmailTemplate.js";
import { runSiteInspectionReminderCheck } from "../services/siteInspectionReminders.js";
import { runPaymentReminderCheck } from "../services/paymentReminders.js";
import { isPasswordPolicySatisfied, PASSWORD_POLICY_MESSAGE } from "../services/passwordPolicy.js";
import { STAFF_TYPES, createDefaultStaffAccess, normalizeStaffAccess } from "../../shared/staffPermissions.js";
import { CURRENT_LEGAL_DOCUMENT_VERSIONS } from "../../shared/legalDocuments.js";

const backupImportUpload = multer({
  ...(process.env.VERCEL === "1" ? { storage: multer.memoryStorage() } : { dest: "backups/incoming" }),
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const filename = file.originalname.toLowerCase();
    if (!filename.endsWith(".zip") && !filename.endsWith(".json.gz") && !filename.endsWith(".json.gz.enc")) {
      const error = new Error("Upload an encrypted .zip backup, or a legacy .json.gz backup file.");
      error.status = 400;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

const recordBackupOperation = async (req, action, outcome, backup, details = "") => {
  try {
    await BackupOperationAudit.create({
      actor_id: String(req.user?.id || ""),
      actor_role: String(req.user?.role || "unknown"),
      action,
      outcome,
      backup_id: backup?.id || null,
      backup_name: backup?.name || null,
      details: String(details).slice(0, 500),
    });
  } catch (error) {
    console.error("Unable to record backup operation audit:", error.message);
  }
};

const SUPER_ADMIN_PROMOTION_LOCK_TTL_MS = 60_000;
const MAX_ACTIVE_SUPER_ADMINS = 2;

const countActiveSuperAdmins = async () => {
  const [adminAccounts, userAccounts] = await Promise.all([
    Admin.find({ is_active: { $ne: false } }).select("_id email").lean(),
    User.find({ role: { $in: ["admin", "super_admin"] }, is_active: { $ne: false } }).select("_id email").lean(),
  ]);
  const identities = new Set();
  [...adminAccounts, ...userAccounts].forEach((account) => {
    identities.add(String(account.email || account._id).trim().toLowerCase());
  });
  return identities.size;
};

const getPrimarySuperAdminId = async () => {
  const primaryAdmin = await Admin.findOne({ is_active: { $ne: false } })
    .sort({ createdAt: 1, _id: 1 })
    .select("_id")
    .lean();
  return primaryAdmin?._id ? String(primaryAdmin._id) : null;
};

const sanitizeStaffAccess = (staffAccess) => staffAccess && typeof staffAccess === "object" && !Array.isArray(staffAccess) ? normalizeStaffAccess(staffAccess) : null;
const migrateStaffAccess = (staffAccess) => normalizeStaffAccess(staffAccess || {});

const router = express.Router();
const ADMIN_RECOVERY_STATE_KEY = "primary-administrator";
const RECOVERY_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const RECOVERY_SESSION_MS = 5 * 60 * 1000;
const hashVerificationToken = (token) => createHash("sha256").update(token).digest("hex");
const verificationHashesMatch = (firstHash, secondHash) => {
  const first = Buffer.from(String(firstHash || ""), "hex");
  const second = Buffer.from(String(secondHash || ""), "hex");
  return first.length === second.length && first.length > 0 && timingSafeEqual(first, second);
};

const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_MAX_REQUESTS = 5;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_REQUEST_LOCK_MS = 2 * 60 * 1000;
const BACKUP_RECOVERY_CODE_TTL_MS = 10 * 60 * 1000;
const BACKUP_RECOVERY_CODE_COOLDOWN_MS = 60 * 1000;
const BACKUP_RECOVERY_CODE_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const BACKUP_RECOVERY_CODE_MAX_REQUESTS = 10;
const BACKUP_RECOVERY_CODE_MAX_ATTEMPTS = 5;
const BACKUP_RECOVERY_CODE_LOCK_MS = 2 * 60 * 1000;

const reservePasswordResetRequest = async (Model, accountId) => {
  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - PASSWORD_RESET_COOLDOWN_MS);
  const windowCutoff = new Date(now.getTime() - PASSWORD_RESET_REQUEST_WINDOW_MS);
  const baseFilter = {
    _id: accountId,
    $and: [
      { $or: [
        { password_reset_sent_at: null },
        { password_reset_sent_at: { $lte: cooldownCutoff } },
      ] },
      { $or: [
        { password_reset_request_lock_until: null },
        { password_reset_request_lock_until: { $lte: now } },
      ] },
    ],
  };
  const lockUntil = new Date(now.getTime() + PASSWORD_RESET_REQUEST_LOCK_MS);
  const invalidatePreviousCode = {
    $set: {
      password_reset_code: null,
      password_reset_expires: null,
      password_reset_attempts: 0,
      password_reset_request_lock_until: lockUntil,
    },
  };

  const newWindowAccount = await Model.findOneAndUpdate({
    ...baseFilter,
    $or: [
      { password_reset_request_window_started_at: null },
      { password_reset_request_window_started_at: { $lte: windowCutoff } },
    ],
  }, {
    ...invalidatePreviousCode,
    $set: {
      ...invalidatePreviousCode.$set,
      password_reset_request_window_started_at: now,
      password_reset_request_count: 1,
    },
  }, { new: true });
  if (newWindowAccount) return newWindowAccount;

  return Model.findOneAndUpdate({
    ...baseFilter,
    password_reset_request_window_started_at: { $gt: windowCutoff },
    password_reset_request_count: { $lt: PASSWORD_RESET_MAX_REQUESTS },
  }, {
    ...invalidatePreviousCode,
    $inc: { password_reset_request_count: 1 },
  }, { new: true });
};

const getPasswordResetTiming = (account, now = new Date()) => {
  const fallbackSentAt = now;
  const expiresAt = account?.password_reset_expires || new Date(fallbackSentAt.getTime() + PASSWORD_RESET_TTL_MS);
  const sentAt = account?.password_reset_sent_at || fallbackSentAt;
  return {
    expiresAt: expiresAt.toISOString(),
    resendAvailableAt: new Date(sentAt.getTime() + PASSWORD_RESET_COOLDOWN_MS).toISOString(),
    serverNow: now.toISOString(),
  };
};

const getPasswordResetRetrySeconds = (account, now = new Date()) => {
  const nowMs = now.getTime();
  const cooldownRemaining = account.password_reset_sent_at
    ? account.password_reset_sent_at.getTime() + PASSWORD_RESET_COOLDOWN_MS - nowMs
    : 0;
  const lockRemaining = account.password_reset_request_lock_until
    ? account.password_reset_request_lock_until.getTime() - nowMs
    : 0;
  const windowRemaining = account.password_reset_request_count >= PASSWORD_RESET_MAX_REQUESTS
    && account.password_reset_request_window_started_at
    ? account.password_reset_request_window_started_at.getTime() + PASSWORD_RESET_REQUEST_WINDOW_MS - nowMs
    : 0;
  return Math.max(1, Math.ceil(Math.max(cooldownRemaining, lockRemaining, windowRemaining, 0) / 1000));
};

const findValidAdministrator = async () => {
  const [admins, legacyAdmins] = await Promise.all([
    Admin.find({}).select("+password").lean(),
    User.find({ role: "admin" }).select("+password").lean(),
  ]);
  return [...admins, ...legacyAdmins].find(isValidAdminRecord) || null;
};

const recordRecoveryFailure = async (key) => {
  while (true) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - RECOVERY_ATTEMPT_WINDOW_MS);
    const current = await AdminRecoveryAttempt.findOne({ key }).lean();
    if (!current) {
      const nextAllowedAt = new Date(now.getTime() + getRecoveryRetryDelaySeconds(1) * 1000);
      try {
        await AdminRecoveryAttempt.create({
          key,
          window_started_at: now,
          failed_attempts: 1,
          next_allowed_at: nextAllowedAt,
          expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });
        return { retryAfterSeconds: getRecoveryRetryDelaySeconds(1) };
      } catch (error) {
        if (error.code === 11000) continue;
        throw error;
      }
    }

    const isExpiredWindow = new Date(current.window_started_at) <= cutoff;
    const failedAttempts = isExpiredWindow ? 1 : (Number(current.failed_attempts) || 0) + 1;
    const retryAfterSeconds = getRecoveryRetryDelaySeconds(failedAttempts);
    const nextAllowedAt = new Date(now.getTime() + retryAfterSeconds * 1000);
    const filter = { key, window_started_at: current.window_started_at };
    const update = isExpiredWindow
      ? { $set: { window_started_at: now, failed_attempts: 1, next_allowed_at: nextAllowedAt, expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000) } }
      : { $set: { failed_attempts: failedAttempts, next_allowed_at: nextAllowedAt, expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000) } };
    filter.failed_attempts = Number(current.failed_attempts) || 0;

    const updated = await AdminRecoveryAttempt.findOneAndUpdate(filter, update, { new: true }).lean();
    if (!updated) continue;
    return { retryAfterSeconds };
  }
};

const recoveryUnavailable = (res) => res.status(403).json({
  success: false,
  message: "Recovery is unavailable or the provided recovery details are invalid.",
});

const validateRecoveryProfile = (body = {}) => {
  const { email, username, password, first_name, last_name } = body;
  return Boolean(
    typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 254 &&
    typeof username === "string" && /^[a-zA-Z0-9._-]{6,12}$/.test(username.trim()) &&
    typeof first_name === "string" && first_name.trim() && first_name.trim().length <= 50 &&
    typeof last_name === "string" && last_name.trim() && last_name.trim().length <= 50 &&
    isPasswordPolicySatisfied(password)
  );
};

const normalizeRecoveryProfile = (body) => ({
  email: body.email.trim().toLowerCase(),
  username: body.username.trim().toLowerCase(),
  password: body.password,
  first_name: body.first_name.trim(),
  last_name: body.last_name.trim(),
  phone: typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "",
  street_address: typeof body.street_address === "string" ? body.street_address.trim().slice(0, 200) : "",
  city: typeof body.city === "string" ? body.city.trim().slice(0, 100) : "",
  province: typeof body.province === "string" ? body.province.trim().slice(0, 100) : "",
  zip_code: typeof body.zip_code === "string" ? body.zip_code.trim().slice(0, 20) : "",
});

router.post("/admin-recovery/verify", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    if (mongoose.connection.readyState !== 1 || !recoveryConfigurationIsValid()) {
      return recoveryUnavailable(res);
    }
    if (await findValidAdministrator()) return recoveryUnavailable(res);

    const attemptKey = hashRecoveryIp(req.ip);
    const attempt = await AdminRecoveryAttempt.findOne({ key: attemptKey }).lean();
    const retryAfterSeconds = Math.ceil((new Date(attempt?.next_allowed_at || 0).getTime() - Date.now()) / 1000);
    if (retryAfterSeconds > 0) {
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ success: false, message: `Please wait ${retryAfterSeconds} seconds before trying again.` });
    }

    const timestamp = Date.now();
    const totpStep = verifyRecoveryCredentials(req.body || {}, process.env, timestamp);
    if (totpStep === null) {
      const { retryAfterSeconds: retryDelay } = await recordRecoveryFailure(attemptKey);
      res.set("Retry-After", String(retryDelay));
      return res.status(401).json({
        success: false,
        message: "Recovery is unavailable or the provided recovery details are invalid.",
      });
    }

    const state = await AdminRecoveryState.findOneAndUpdate(
      { key: ADMIN_RECOVERY_STATE_KEY },
      { $setOnInsert: { last_totp_step: -1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const recoverySession = randomBytes(32).toString("base64url");
    const claimedState = await AdminRecoveryState.findOneAndUpdate(
      {
        _id: state._id,
        completed_at: null,
        last_totp_step: { $lt: totpStep },
      },
      {
        $set: {
          last_totp_step: totpStep,
          recovery_session_hash: hashVerificationToken(recoverySession),
          recovery_session_expires_at: new Date(timestamp + RECOVERY_SESSION_MS),
        },
      },
      { new: true }
    ).lean();
    if (!claimedState) return recoveryUnavailable(res);

    await AdminRecoveryAttempt.deleteOne({ key: attemptKey });
    return res.json({ success: true, recoverySession, expiresIn: RECOVERY_SESSION_MS / 1000 });
  } catch (error) {
    console.error("[admin-recovery] Verification failed:", error.name || "Error");
    return res.status(mongoose.connection.readyState === 1 ? 500 : 503).json({
      success: false,
      message: "Unable to complete recovery right now. Please try again later.",
    });
  }
});

router.post("/admin-recovery/restore", async (req, res) => {
  let lockId = null;
  let stateId = null;
  let recoveryAuditId = null;
  let restoredAccount = false;
  res.set("Cache-Control", "no-store");
  try {
    if (mongoose.connection.readyState !== 1 || !recoveryConfigurationIsValid()) {
      return recoveryUnavailable(res);
    }
    const { recoverySession } = req.body || {};
    if (typeof recoverySession !== "string" || recoverySession.length < 40 || recoverySession.length > 64 || !validateRecoveryProfile(req.body)) {
      return res.status(400).json({ success: false, message: "Enter valid administrator details and a strong password." });
    }
    const recoverySessionHash = hashVerificationToken(recoverySession);
    const state = await AdminRecoveryState.findOne({
      key: ADMIN_RECOVERY_STATE_KEY,
      recovery_session_hash: recoverySessionHash,
      recovery_session_expires_at: { $gt: new Date() },
      completed_at: null,
    }).lean();
    if (!state) return recoveryUnavailable(res);

    lockId = randomBytes(16).toString("hex");
    const lockedState = await AdminRecoveryState.findOneAndUpdate(
      {
        _id: state._id,
        recovery_session_hash: recoverySessionHash,
        recovery_session_expires_at: { $gt: new Date() },
        completed_at: null,
        $or: [
          { lock_expires_at: null },
          { lock_expires_at: { $lte: new Date() } },
        ],
      },
      { $set: { lock_id: lockId, lock_expires_at: new Date(Date.now() + 60_000) } },
      { new: true }
    ).lean();
    if (!lockedState) return recoveryUnavailable(res);
    stateId = lockedState._id;

    if (await findValidAdministrator()) return recoveryUnavailable(res);

    const profile = normalizeRecoveryProfile(req.body);
    const identityQuery = { $or: [{ email: profile.email }, { username: profile.username }] };
    const [adminMatches, userMatches] = await Promise.all([
      Admin.find(identityQuery).select("+password"),
      User.find(identityQuery).select("+password"),
    ]);
    const corruptAdmin = adminMatches.find((account) => !isValidAdminRecord(account));
    const corruptLegacyAdmin = userMatches.find((account) => account.role === "admin" && !isValidAdminRecord(account));
    const restoreTarget = corruptAdmin || corruptLegacyAdmin || null;
    const conflictingAccount = [...adminMatches, ...userMatches].find((account) =>
      account._id.toString() !== restoreTarget?._id.toString()
    );
    if (conflictingAccount) {
      return res.status(409).json({ success: false, message: "Those account details cannot be used. Contact system support." });
    }

    const audit = await AdminRecoveryAudit.create({
      action: "administrator_restored",
      account_id: restoreTarget?._id || new mongoose.Types.ObjectId(),
      account_username: profile.username,
      account_email: profile.email,
      source_ip_hash: hashRecoveryIp(req.ip),
      user_agent: String(req.get("user-agent") || "").slice(0, 300),
    });
    recoveryAuditId = audit._id;

    const account = restoreTarget || new Admin();
    if (restoreTarget) account.session_version = (Number(account.session_version) || 0) + 1;
    Object.assign(account, profile);
    account.is_active = true;
    if (account instanceof User) account.role = "admin";
    if (account instanceof User) {
      account.email_verified = true;
      account.email_verification_token = null;
      account.email_verification_expires = null;
    }
    await account.save();
    restoredAccount = true;

    audit.account_id = account._id;
    audit.outcome = "success";
    await audit.save();
    await AdminRecoveryState.updateOne(
      { _id: stateId, lock_id: lockId, recovery_session_hash: recoverySessionHash },
      {
        $set: { completed_at: new Date() },
        $unset: {
          recovery_session_hash: 1,
          recovery_session_expires_at: 1,
          lock_id: 1,
          lock_expires_at: 1,
        },
      }
    );

    return res.status(201).json({
      success: true,
      message: "Administrator access has been restored. Sign in with the new administrator account.",
    });
  } catch (error) {
    console.error("[admin-recovery] Restore failed:", error.name || "Error");
    if (recoveryAuditId) {
      await AdminRecoveryAudit.updateOne(
        { _id: recoveryAuditId },
        { $set: { outcome: restoredAccount ? "success" : "failed" } }
      ).catch(() => {});
    }
    return res.status(mongoose.connection.readyState === 1 ? 500 : 503).json({
      success: false,
      message: "Unable to complete recovery right now. Please try again later.",
    });
  } finally {
    if (stateId && lockId) {
      await AdminRecoveryState.updateOne(
        { _id: stateId, lock_id: lockId, completed_at: null },
        { $unset: { lock_id: 1, lock_expires_at: 1 } }
      ).catch(() => {});
    }
  }
});

const sendVerificationEmail = async (user, token) => {
  const verificationUrl = buildFrontendUrl("/verify-email", { token });
  const email = buildCustomerEmailTemplate({
    title: "Verify your ACGC email address",
    summary: `Hello ${user.first_name || ""}, verify your ACGC account using the button below.`,
    status: "Email Verification",
    fields: [["Email address", user.email]],
    nextSteps: "This verification link expires in 24 hours.",
    actionUrl: verificationUrl,
    actionLabel: "Verify email address",
  });

  await sendMail({
    from: process.env.EMAIL_FROM || "ACGC <no-reply@acgc.local>",
    to: user.email,
    subject: "Verify your ACGC email address",
    ...email,
  });
};

const sendPendingEmailVerificationCode = async (user, pendingEmail, code) => {
  const email = buildCustomerEmailTemplate({
    title: "Your ACGC email verification code",
    summary: `Hello ${user.first_name || ""}, enter this code to verify your new email address.`,
    status: "Email Verification",
    fields: [["Verification code", code], ["New email address", pendingEmail]],
    nextSteps: "This code expires in 10 minutes. Your current email remains active until the new address is verified.",
  });
  await sendMail({
    from: process.env.EMAIL_FROM || "ACGC <no-reply@acgc.local>",
    to: pendingEmail,
    subject: "Your ACGC email verification code",
    ...email,
  });
};

const createEmailChangeCode = async (user, pendingEmail) => {
  const code = String(randomInt(100000, 1000000));
  user.pending_email_verification_code = hashVerificationToken(`${user._id}:${pendingEmail}:${code}`);
  user.pending_email_verification_expires = new Date(Date.now() + 10 * 60 * 1000);
  user.pending_email_verification_attempts = 0;
  user.pending_email_verification_sent_at = new Date();
  await user.save();
  await sendPendingEmailVerificationCode(user, pendingEmail, code);
};

const sendPendingUsernameVerificationCode = async (user, code) => {
  const email = buildCustomerEmailTemplate({
    title: "Your ACGC username verification code",
    summary: `Hello ${user.first_name || ""}, enter this code to verify your account before changing your username.`,
    status: "Account Verification",
    fields: [["Verification code", code]],
    nextSteps: "This code expires in 10 minutes. After verifying it, you can choose a new username.",
  });
  await sendMail({
    from: process.env.EMAIL_FROM || "ACGC <no-reply@acgc.local>",
    to: user.email,
    subject: "Your ACGC username verification code",
    ...email,
  });
};

const createUsernameChangeCode = async (account) => {
  const code = String(randomInt(100000, 1000000));
  account.pending_username_verification_code = hashVerificationToken(`${account._id}:username-change:${code}`);
  account.pending_username_verification_expires = new Date(Date.now() + 10 * 60 * 1000);
  account.pending_username_verification_attempts = 0;
  account.pending_username_verification_sent_at = new Date();
  await account.save();
  await sendPendingUsernameVerificationCode(account, code);
};

const getProfileEmailChangeAccount = async (req) => {
  let AccountModel = req.user.auth_source === "admin" || (!req.user.auth_source && ["admin", "super_admin"].includes(req.user.role))
    ? Admin
    : User;
  let account = await AccountModel.findById(req.user.id);

  if (!account && !req.user.auth_source && AccountModel === Admin) {
    AccountModel = User;
    account = await AccountModel.findById(req.user.id);
  }

  return { account, AccountModel };
};

const hasEmailChangeConflict = async (email, account, AccountModel) => {
  const userFilter = AccountModel === User ? { _id: { $ne: account._id } } : {};
  const adminFilter = AccountModel === Admin ? { _id: { $ne: account._id } } : {};
  const [existingUser, existingPendingUser, existingAdmin, existingPendingAdmin] = await Promise.all([
    User.findOne({ email, ...userFilter }).select("_id"),
    User.findOne({ pending_email: email, ...userFilter }).select("_id"),
    Admin.findOne({ email, ...adminFilter }).select("_id"),
    Admin.findOne({ pending_email: email, ...adminFilter }).select("_id"),
  ]);
  return Boolean(existingUser || existingPendingUser || existingAdmin || existingPendingAdmin);
};

const hasUsernameChangeConflict = async (username, account, AccountModel) => {
  const userFilter = AccountModel === User ? { _id: { $ne: account._id } } : {};
  const adminFilter = AccountModel === Admin ? { _id: { $ne: account._id } } : {};
  const [existingUser, pendingUser, existingAdmin, pendingAdmin] = await Promise.all([
    User.findOne({ username, ...userFilter }).select("_id"),
    User.findOne({ pending_username: username, ...userFilter }).select("_id"),
    Admin.findOne({ username, ...adminFilter }).select("_id"),
    Admin.findOne({ pending_username: username, ...adminFilter }).select("_id"),
  ]);
  return Boolean(existingUser || pendingUser || existingAdmin || pendingAdmin);
};

const sendPasswordResetCode = async (account, code) => {
  const email = buildCustomerEmailTemplate({
    title: "Your ACGC password reset code",
    summary: `Hello ${account.first_name || ""}, use this code to reset your password.`,
    status: "Account Security",
    fields: [["Password reset code", code]],
    nextSteps: "This code expires in 15 minutes. If you did not request this, you can ignore this email.",
  });
  await sendMail({
    from: process.env.EMAIL_FROM || "ACGC <no-reply@acgc.local>",
    to: account.email,
    subject: "Your ACGC password reset code",
    ...email,
  });
};

router.get("/system-settings", authMiddleware, staffModulePermissionIfStaff("settings", "view"), async (req, res) => {
  try {
    const settings = await SystemSetting.findOne({ key: "global" })
      .select("+backup_recovery_password_salt +backup_recovery_password_hash")
      .lean();
    const backupHistory = await hydrateBackupHistorySizes(settings?.backup_history);
    const backupSchedule = ["daily", "weekly", "monthly"].includes(settings?.backup_schedule)
      ? settings.backup_schedule
      : "weekly";
    const backupScheduleTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(settings?.backup_schedule_time || "")
      ? settings.backup_schedule_time
      : "00:00";
    res.json({
      success: true,
      maintenance_mode: settings?.maintenance_mode === true,
      global_permissions: settings?.global_permissions || null,
      business_hours: settings?.business_hours || { open: "08:00", close: "18:00", timezone: "Asia/Manila" },
      backup_schedule: backupSchedule,
      backup_schedule_time: backupScheduleTime,
      backup_status: settings?.backup_status || "Success",
      last_backup_at: settings?.last_backup_at || null,
      backup_history: backupHistory,
      backup_recovery_password_configured: Boolean(settings?.backup_recovery_password_salt && settings?.backup_recovery_password_hash),
      next_backup_at: getNextScheduledBackupAt(backupSchedule, backupScheduleTime),
    });
  } catch (error) {
    console.error("Get system settings error:", error);
    res.status(500).json({ success: false, message: "Unable to load system settings." });
  }
});

router.put("/system-settings/backups/recovery-password", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  try {
    const settings = await SystemSetting.findOne({ key: "global" })
      .select("+backup_recovery_password_salt +backup_recovery_password_hash")
      .lean();
    const isConfigured = Boolean(settings?.backup_recovery_password_salt && settings?.backup_recovery_password_hash);

    if (isConfigured) {
      const currentPasswordValid = await verifyBackupRecoveryPassword(
        req.body?.current_password,
        settings.backup_recovery_password_salt,
        settings.backup_recovery_password_hash,
      );
      if (!currentPasswordValid) {
        return res.status(403).json({ success: false, message: "The current recovery password is incorrect." });
      }
    }

    const verifier = await hashBackupRecoveryPassword(req.body?.new_password);
    await SystemSetting.findOneAndUpdate(
      { key: "global" },
      {
        $set: {
          backup_recovery_password_salt: verifier.salt,
          backup_recovery_password_hash: verifier.hash,
          backup_recovery_password_display: req.body?.new_password,
          backup_recovery_password_set_at: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    return res.json({ success: true, backup_recovery_password_configured: true });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Unable to update the recovery password.",
    });
  }
});

router.post("/system-settings/backups/recovery-password/forgot", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const { account } = await getProfileEmailChangeAccount(req);
    const email = String(account?.email || "").trim().toLowerCase();
    if (!account || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Add a valid email to your administrator account before resetting the recovery password." });
    }

    const currentSettings = await SystemSetting.findOne({ key: "global" })
      .select("+backup_recovery_password_hash")
      .lean();
    if (!currentSettings?.backup_recovery_password_hash) {
      return res.status(409).json({ success: false, message: "A recovery password has not been set yet." });
    }

    const now = new Date();
    const cooldownCutoff = new Date(now.getTime() - BACKUP_RECOVERY_CODE_COOLDOWN_MS);
    const requestWindowCutoff = new Date(now.getTime() - BACKUP_RECOVERY_CODE_REQUEST_WINDOW_MS);
    const requestLockUntil = new Date(now.getTime() + BACKUP_RECOVERY_CODE_LOCK_MS);
    const commonRequestFilter = {
      key: "global",
      $and: [
        { $or: [{ backup_recovery_password_reset_sent_at: null }, { backup_recovery_password_reset_sent_at: { $lte: cooldownCutoff } }] },
        { $or: [{ backup_recovery_password_reset_lock_until: null }, { backup_recovery_password_reset_lock_until: { $lte: now } }] },
      ],
    };
    const newWindowRequest = await SystemSetting.findOneAndUpdate({
      ...commonRequestFilter,
      $and: [
        ...commonRequestFilter.$and,
        { $or: [
          { backup_recovery_password_reset_window_started_at: null },
          { backup_recovery_password_reset_window_started_at: { $lte: requestWindowCutoff } },
        ] },
      ],
    }, {
      $set: {
        backup_recovery_password_reset_window_started_at: now,
        backup_recovery_password_reset_request_count: 1,
        backup_recovery_password_reset_sent_at: now,
        backup_recovery_password_reset_lock_until: requestLockUntil,
        backup_recovery_password_reset_code_hash: null,
        backup_recovery_password_reset_expires_at: null,
        backup_recovery_password_reset_attempts: 0,
      },
    }, { new: true });
    const reservedSettings = newWindowRequest || await SystemSetting.findOneAndUpdate({
      ...commonRequestFilter,
      backup_recovery_password_reset_window_started_at: { $gt: requestWindowCutoff },
      backup_recovery_password_reset_request_count: { $lt: BACKUP_RECOVERY_CODE_MAX_REQUESTS },
    }, {
      $inc: { backup_recovery_password_reset_request_count: 1 },
      $set: {
        backup_recovery_password_reset_sent_at: now,
        backup_recovery_password_reset_lock_until: requestLockUntil,
        backup_recovery_password_reset_code_hash: null,
        backup_recovery_password_reset_expires_at: null,
        backup_recovery_password_reset_attempts: 0,
      },
    }, { new: true });

    if (!reservedSettings) {
      const currentRequest = await SystemSetting.findOne({ key: "global" })
        .select("+backup_recovery_password_reset_code_hash +backup_recovery_password_reset_expires_at +backup_recovery_password_reset_sent_at +backup_recovery_password_reset_window_started_at +backup_recovery_password_reset_request_count +backup_recovery_password_reset_lock_until")
        .lean();
      if (currentRequest?.backup_recovery_password_reset_code_hash && currentRequest.backup_recovery_password_reset_expires_at > now) {
        return res.json({
          success: true,
          message: "A recovery password code was already sent and is still valid. Check your administrator email.",
          expires_at: currentRequest.backup_recovery_password_reset_expires_at.toISOString(),
        });
      }

      const retryAt = [
        currentRequest?.backup_recovery_password_reset_lock_until,
        currentRequest?.backup_recovery_password_reset_sent_at
          ? new Date(currentRequest.backup_recovery_password_reset_sent_at.getTime() + BACKUP_RECOVERY_CODE_COOLDOWN_MS)
          : null,
        currentRequest?.backup_recovery_password_reset_window_started_at
          && currentRequest.backup_recovery_password_reset_request_count >= BACKUP_RECOVERY_CODE_MAX_REQUESTS
          ? new Date(currentRequest.backup_recovery_password_reset_window_started_at.getTime() + BACKUP_RECOVERY_CODE_REQUEST_WINDOW_MS)
          : null,
      ].filter((date) => date instanceof Date && date > now).sort((a, b) => b - a)[0];
      const retryAfterSeconds = retryAt ? Math.ceil((retryAt.getTime() - now.getTime()) / 1000) : BACKUP_RECOVERY_CODE_COOLDOWN_MS / 1000;
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ success: false, retry_after_seconds: retryAfterSeconds, message: `Please wait ${retryAfterSeconds} seconds before requesting another recovery password code.` });
    }

    const code = String(randomInt(100000, 1000000));
    const codeHash = hashVerificationToken(`${reservedSettings._id}:${account._id}:${email}:${code}`);
    const expiresAt = new Date(now.getTime() + BACKUP_RECOVERY_CODE_TTL_MS);
    const activeRequest = await SystemSetting.findOneAndUpdate({
      _id: reservedSettings._id,
      backup_recovery_password_reset_lock_until: requestLockUntil,
    }, {
      $set: {
        backup_recovery_password_reset_code_hash: codeHash,
        backup_recovery_password_reset_expires_at: expiresAt,
        backup_recovery_password_reset_attempts: 0,
      },
    }, { new: true });
    if (!activeRequest) {
      return res.status(429).json({ success: false, message: "Please wait before requesting another recovery password code." });
    }

    const emailContent = buildCustomerEmailTemplate({
      title: "Your ACGC recovery password reset code",
      summary: `Hello ${account.first_name || "Administrator"}, enter this code to reset the backup recovery password for your account.`,
      status: "Backup Recovery Password",
      fields: [["Verification code", code]],
      nextSteps: "This code expires in 10 minutes. If you did not request this code, no action is needed.",
    });
    try {
      await sendMail({
        from: process.env.EMAIL_FROM || "ACGC <no-reply@acgc.local>",
        to: email,
        subject: "Your ACGC recovery password reset code",
        ...emailContent,
      });
    } catch (mailError) {
      await SystemSetting.updateOne(
        { _id: reservedSettings._id, backup_recovery_password_reset_code_hash: codeHash },
        { $set: { backup_recovery_password_reset_code_hash: null, backup_recovery_password_reset_expires_at: null, backup_recovery_password_reset_lock_until: null } },
      );
      console.error("Backup recovery password reset email failed:", mailError);
      return res.status(502).json({ success: false, message: "Unable to send the verification code. Check the email service and try again." });
    }

    await SystemSetting.updateOne(
      { _id: reservedSettings._id, backup_recovery_password_reset_code_hash: codeHash },
      { $set: { backup_recovery_password_reset_lock_until: null } },
    );
    return res.json({ success: true, message: "A recovery password code was sent to your administrator email.", expires_at: expiresAt.toISOString() });
  } catch (error) {
    console.error("Request backup recovery password reset error:", error);
    return res.status(500).json({ success: false, message: "Unable to request a recovery password reset code." });
  }
});

router.post("/system-settings/backups/recovery-password/forgot/verify", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const code = String(req.body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: "Enter the six-digit verification code." });
    }

    const { account } = await getProfileEmailChangeAccount(req);
    const email = String(account?.email || "").trim().toLowerCase();
    if (!account || !email) return res.status(403).json({ success: false, message: "Unable to verify this recovery password reset." });

    const settings = await SystemSetting.findOne({ key: "global" })
      .select("+backup_recovery_password_reset_code_hash +backup_recovery_password_reset_expires_at +backup_recovery_password_reset_attempts")
      .lean();
    const now = new Date();
    if (!settings?.backup_recovery_password_reset_code_hash || !settings.backup_recovery_password_reset_expires_at || settings.backup_recovery_password_reset_expires_at <= now) {
      if (settings?.backup_recovery_password_reset_expires_at && settings.backup_recovery_password_reset_expires_at <= now) {
        await SystemSetting.updateOne(
          { _id: settings._id, backup_recovery_password_reset_expires_at: { $lte: now } },
          { $set: { backup_recovery_password_reset_code_hash: null, backup_recovery_password_reset_expires_at: null, backup_recovery_password_reset_attempts: 0 } },
        );
      }
      return res.status(400).json({ success: false, message: "The code is invalid or expired. Request a new code to continue." });
    }
    if (settings.backup_recovery_password_reset_attempts >= BACKUP_RECOVERY_CODE_MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, message: "Too many incorrect codes. Request a new code to continue." });
    }

    const expectedCodeHash = hashVerificationToken(`${settings._id}:${account._id}:${email}:${code}`);
    if (!verificationHashesMatch(expectedCodeHash, settings.backup_recovery_password_reset_code_hash)) {
      const updated = await SystemSetting.findOneAndUpdate({
        _id: settings._id,
        backup_recovery_password_reset_code_hash: settings.backup_recovery_password_reset_code_hash,
        backup_recovery_password_reset_expires_at: { $gt: now },
        backup_recovery_password_reset_attempts: { $lt: BACKUP_RECOVERY_CODE_MAX_ATTEMPTS },
      }, { $inc: { backup_recovery_password_reset_attempts: 1 } }, { new: true });
      if (updated?.backup_recovery_password_reset_attempts >= BACKUP_RECOVERY_CODE_MAX_ATTEMPTS) {
        await SystemSetting.updateOne(
          { _id: updated._id, backup_recovery_password_reset_code_hash: settings.backup_recovery_password_reset_code_hash },
          { $set: { backup_recovery_password_reset_code_hash: null, backup_recovery_password_reset_expires_at: null } },
        );
        return res.status(429).json({ success: false, message: "Too many incorrect codes. Request a new code to continue." });
      }
      return res.status(400).json({ success: false, message: "The verification code is incorrect." });
    }

    return res.json({ success: true, message: "Verification code confirmed." });
  } catch (error) {
    console.error("Verify backup recovery password reset code error:", error);
    return res.status(500).json({ success: false, message: "Unable to verify the recovery password reset code." });
  }
});

router.put("/system-settings/backups/recovery-password/forgot", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const code = String(req.body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: "Enter the six-digit verification code." });
    }

    const { account } = await getProfileEmailChangeAccount(req);
    const email = String(account?.email || "").trim().toLowerCase();
    if (!account || !email) return res.status(403).json({ success: false, message: "Unable to verify this recovery password reset." });

    validateBackupRecoveryPassword(req.body?.new_password);
    const settings = await SystemSetting.findOne({ key: "global" })
      .select("+backup_recovery_password_reset_code_hash +backup_recovery_password_reset_expires_at +backup_recovery_password_reset_attempts")
      .lean();
    const now = new Date();
    if (!settings?.backup_recovery_password_reset_code_hash || !settings.backup_recovery_password_reset_expires_at || settings.backup_recovery_password_reset_expires_at <= now) {
      if (settings?.backup_recovery_password_reset_expires_at && settings.backup_recovery_password_reset_expires_at <= now) {
        await SystemSetting.updateOne(
          { _id: settings._id, backup_recovery_password_reset_expires_at: { $lte: now } },
          { $set: { backup_recovery_password_reset_code_hash: null, backup_recovery_password_reset_expires_at: null, backup_recovery_password_reset_attempts: 0 } },
        );
      }
      return res.status(400).json({ success: false, message: "The code is invalid or expired. Request a new code to continue." });
    }
    if (settings.backup_recovery_password_reset_attempts >= BACKUP_RECOVERY_CODE_MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, message: "Too many incorrect codes. Request a new code to continue." });
    }

    const expectedCodeHash = hashVerificationToken(`${settings._id}:${account._id}:${email}:${code}`);
    if (!verificationHashesMatch(expectedCodeHash, settings.backup_recovery_password_reset_code_hash)) {
      const updated = await SystemSetting.findOneAndUpdate({
        _id: settings._id,
        backup_recovery_password_reset_code_hash: settings.backup_recovery_password_reset_code_hash,
        backup_recovery_password_reset_expires_at: { $gt: now },
        backup_recovery_password_reset_attempts: { $lt: BACKUP_RECOVERY_CODE_MAX_ATTEMPTS },
      }, { $inc: { backup_recovery_password_reset_attempts: 1 } }, { new: true });
      if (updated?.backup_recovery_password_reset_attempts >= BACKUP_RECOVERY_CODE_MAX_ATTEMPTS) {
        await SystemSetting.updateOne(
          { _id: updated._id, backup_recovery_password_reset_code_hash: settings.backup_recovery_password_reset_code_hash },
          { $set: { backup_recovery_password_reset_code_hash: null, backup_recovery_password_reset_expires_at: null } },
        );
        return res.status(429).json({ success: false, message: "Too many incorrect codes. Request a new code to continue." });
      }
      return res.status(400).json({ success: false, message: "The verification code is incorrect." });
    }

    const verifier = await hashBackupRecoveryPassword(req.body?.new_password);
    const updatedSettings = await SystemSetting.findOneAndUpdate({
      _id: settings._id,
      backup_recovery_password_reset_code_hash: settings.backup_recovery_password_reset_code_hash,
      backup_recovery_password_reset_expires_at: { $gt: now },
      backup_recovery_password_reset_attempts: { $lt: BACKUP_RECOVERY_CODE_MAX_ATTEMPTS },
    }, {
      $set: {
        backup_recovery_password_salt: verifier.salt,
        backup_recovery_password_hash: verifier.hash,
        backup_recovery_password_display: req.body.new_password,
        backup_recovery_password_set_at: now,
        backup_recovery_password_reset_code_hash: null,
        backup_recovery_password_reset_expires_at: null,
        backup_recovery_password_reset_attempts: 0,
      },
      $unset: { backup_recovery_password_reset_lock_until: 1 },
    }, { new: true });
    if (!updatedSettings) return res.status(400).json({ success: false, message: "The code is invalid or expired. Request a new code to continue." });

    return res.json({ success: true, backup_recovery_password_configured: true, message: "Backup recovery password reset successfully." });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Unable to reset the recovery password.",
    });
  }
});

router.get("/system-settings/backups/recovery-password", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  try {
    const settings = await SystemSetting.findOne({ key: "global" })
      .select("+backup_recovery_password_display")
      .lean();
    const password = settings?.backup_recovery_password_display;
    if (typeof password !== "string" || password.length === 0) {
      return res.status(404).json({ success: false, message: "The recovery password was set before display support. Change it once to make it viewable." });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, backup_recovery_password: password });
  } catch (error) {
    console.error("Reveal recovery password error:", error);
    res.status(500).json({ success: false, message: "Unable to load the recovery password." });
  }
});

router.get("/customer-permissions", async (_req, res) => {
  try {
    const settings = await SystemSetting.findOne({ key: "global" }).select("global_permissions").lean();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      global_permissions: settings?.global_permissions || null,
    });
  } catch (error) {
    console.error("Get public customer permissions error:", error);
    res.status(500).json({ success: false, message: "Unable to load customer permissions." });
  }
});

router.get("/public-contact", async (_req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, ...await getAdminPublicContact() });
  } catch (error) {
    console.error("Get public business contact error:", error);
    return res.status(500).json({ success: false, message: "Unable to load business contact details." });
  }
});

router.get("/customer-payment-contact", authMiddleware, roleMiddleware("customer"), async (_req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const contact = await getAdminPublicContact();
    return res.json({ success: true, phone: contact.phone });
  } catch (error) {
    console.error("Get customer payment contact error:", error);
    return res.status(500).json({ success: false, message: "Unable to load payment support contact." });
  }
});

router.patch("/system-settings", authMiddleware, roleMiddleware(["admin", "super_admin"]), async (req, res) => {
  try {
    const update = {};
    if (typeof req.body?.maintenance_mode === "boolean") {
      update.maintenance_mode = req.body.maintenance_mode;
    }
    if (req.body?.global_permissions && typeof req.body.global_permissions === "object") {
      update.global_permissions = { ...req.body.global_permissions };
    }
    if (req.body?.business_hours && typeof req.body.business_hours === "object") {
      const { open, close } = req.body.business_hours;
      const validTime = (value) => typeof value === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
      if (!validTime(open) || !validTime(close) || open >= close) {
        return res.status(400).json({ success: false, message: "Business hours must be valid 24-hour times with closing after opening." });
      }
      update.business_hours = { open, close, timezone: "Asia/Manila" };
    }
    if (typeof req.body?.backup_schedule === "string") {
      if (["daily", "weekly", "monthly"].includes(req.body.backup_schedule)) {
        update.backup_schedule = req.body.backup_schedule;
      } else {
        return res.status(400).json({ success: false, message: "Backup schedule must be daily, weekly, or monthly." });
      }
    }
    if (typeof req.body?.backup_schedule_time === "string") {
      if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(req.body.backup_schedule_time)) {
        update.backup_schedule_time = req.body.backup_schedule_time;
      } else {
        return res.status(400).json({ success: false, message: "Backup time must use 24-hour HH:mm format." });
      }
    }
    if (typeof req.body?.backup_status === "string") {
      update.backup_status = req.body.backup_status;
    }
    if (req.body?.last_backup_at) {
      update.last_backup_at = new Date(req.body.last_backup_at);
    }
    if (Array.isArray(req.body?.backup_history)) {
      update.backup_history = req.body.backup_history;
    }

    const settings = await SystemSetting.findOneAndUpdate(
      { key: "global" },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    const backupHistory = await hydrateBackupHistorySizes(settings.backup_history);
    res.json({
      success: true,
      maintenance_mode: settings.maintenance_mode === true,
      global_permissions: settings.global_permissions || null,
      business_hours: settings.business_hours || { open: "08:00", close: "18:00", timezone: "Asia/Manila" },
      backup_schedule: settings.backup_schedule || "weekly",
      backup_schedule_time: settings.backup_schedule_time || "00:00",
      next_backup_at: getNextScheduledBackupAt(
        ["daily", "weekly", "monthly"].includes(settings.backup_schedule) ? settings.backup_schedule : "weekly",
        settings.backup_schedule_time || "00:00",
      ),
      backup_status: settings.backup_status || "Success",
      last_backup_at: settings.last_backup_at || null,
      backup_history: backupHistory,
    });
  } catch (error) {
    console.error("Update system settings error:", error);
    res.status(500).json({ success: false, message: "Unable to update system settings." });
  }
});

router.post("/system-settings/backups", authMiddleware, roleMiddleware(["admin", "super_admin", "skilled_worker"]), staffModulePermission("settings", "back_up"), async (req, res) => {
  try {
    const recoverySettings = await SystemSetting.findOne({ key: "global" })
      .select("+backup_recovery_password_salt +backup_recovery_password_hash")
      .lean();
    if (!recoverySettings?.backup_recovery_password_salt || !recoverySettings?.backup_recovery_password_hash) {
      return res.status(428).json({ success: false, message: "Set a backup recovery password before creating a manual backup." });
    }
    const result = await createSystemBackup(req.body?.type, "Manual");
    await recordBackupOperation(req, "create", "success", result.backup, "Manual backup created.");
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    await recordBackupOperation(req, "create", "failed", null, error.message || "Backup creation failed.");
    await SystemSetting.updateOne({ key: "global" }, { $set: { backup_status: "Failed" } }).catch((statusError) => {
      console.error("Unable to update failed backup status:", statusError.message);
    });
    console.error("Create system backup error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to create backup." });
  }
});

router.get("/system-settings/cron-backup", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const expectedAuthorization = secret ? Buffer.from(`Bearer ${secret}`) : Buffer.alloc(0);
  const providedAuthorization = Buffer.from(req.get("authorization") || "");
  if (!secret || expectedAuthorization.length !== providedAuthorization.length || !timingSafeEqual(expectedAuthorization, providedAuthorization)) {
    return res.status(secret ? 401 : 503).json({ success: false, message: "Scheduled backup authorization is not configured." });
  }

  try {
    await runScheduledBackup();
    return res.json({ success: true, message: "Scheduled backup check completed." });
  } catch (error) {
    console.error("Vercel scheduled backup failed:", error);
    return res.status(500).json({ success: false, message: "Scheduled backup failed." });
  }
});

router.get("/system-settings/cron-site-inspection-reminders", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const expectedAuthorization = secret ? Buffer.from(`Bearer ${secret}`) : Buffer.alloc(0);
  const providedAuthorization = Buffer.from(req.get("authorization") || "");
  if (!secret || expectedAuthorization.length !== providedAuthorization.length || !timingSafeEqual(expectedAuthorization, providedAuthorization)) {
    return res.status(secret ? 401 : 503).json({ success: false, message: "Scheduled reminder authorization is not configured." });
  }

  try {
    const result = await runSiteInspectionReminderCheck({ realtime: req.app.get("realtime") });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Scheduled site inspection reminder check failed:", error);
    return res.status(500).json({ success: false, message: "Scheduled site inspection reminder check failed." });
  }
});

router.get("/system-settings/cron-payment-reminders", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const expectedAuthorization = secret ? Buffer.from(`Bearer ${secret}`) : Buffer.alloc(0);
  const providedAuthorization = Buffer.from(req.get("authorization") || "");
  if (!secret || expectedAuthorization.length !== providedAuthorization.length || !timingSafeEqual(expectedAuthorization, providedAuthorization)) {
    return res.status(secret ? 401 : 503).json({ success: false, message: "Scheduled reminder authorization is not configured." });
  }

  try {
    const result = await runPaymentReminderCheck({ realtime: req.app.get("realtime") });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Scheduled payment reminder check failed:", error);
    return res.status(500).json({ success: false, message: "Scheduled payment reminder check failed." });
  }
});

router.post(
  "/system-settings/backups/import",
  authMiddleware,
  roleMiddleware(["admin", "super_admin", "skilled_worker"]),
  staffModulePermission("settings", "back_up"),
  (req, res, next) => {
    backupImportUpload.single("backupFile")(req, res, (error) => {
      if (!error) return next();
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : error.status || 400;
      return res.status(status).json({ success: false, message: error.message || "Unable to upload backup." });
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Select a backup file to upload." });
    }

    try {
      const result = await importSystemBackup(req.file.buffer || req.file.path);
      await recordBackupOperation(req, "import", "success", result.backup, "Backup archive imported.");
      res.status(201).json({ success: true, ...result });
    } catch (error) {
      await recordBackupOperation(req, "import", "failed", null, error.message || "Backup import failed.");
      console.error("Import system backup error:", error);
      res.status(error.status || 400).json({ success: false, message: error.message || "Unable to import backup." });
    } finally {
      if (req.file.path) await fs.rm(req.file.path, { force: true });
    }
  }
);

router.post("/system-settings/backups/import-cloudinary", authMiddleware, roleMiddleware(["admin", "super_admin", "skilled_worker"]), staffModulePermission("settings", "back_up"), async (req, res) => {
  try {
    const result = await importSystemBackupFromCloudinary(req.body?.public_id, req.body?.format);
    await recordBackupOperation(req, "import", "success", result.backup, "Backup archive imported from private storage.");
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    await recordBackupOperation(req, "import", "failed", null, error.message || "Backup import failed.");
    console.error("Import Cloudinary backup error:", error);
    res.status(error.status || 400).json({ success: false, message: error.message || "Unable to import backup." });
  }
});

router.get("/system-settings/backups/:backupId/download", authMiddleware, roleMiddleware(["admin", "super_admin", "skilled_worker"]), staffModulePermission("settings", "back_up"), async (req, res) => {
  try {
    const { buffer, filename, remoteUrl } = await getSystemBackupDownload(req.params.backupId);
    if (remoteUrl) {
      const remoteResponse = await fetch(remoteUrl);
      if (!remoteResponse.ok || !remoteResponse.body) {
        return res.status(502).json({ success: false, message: "Backup file is not available for download." });
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      const contentLength = remoteResponse.headers.get("content-length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      try {
        await pipeline(Readable.fromWeb(remoteResponse.body), res);
      } catch (streamError) {
        console.error("Stream Cloudinary backup download error:", streamError);
        if (!res.headersSent) res.status(502).json({ success: false, message: "Unable to stream backup download." });
        else res.destroy(streamError);
      }
      return;
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("Download system backup error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to download backup." });
  }
});

router.post("/system-settings/backups/:backupId/restore", authMiddleware, roleMiddleware(["admin", "super_admin", "skilled_worker"]), staffModulePermission("settings", "back_up"), async (req, res) => {
  let backup;
  try {
    const settings = await SystemSetting.findOne({ key: "global" })
      .select("+backup_recovery_password_salt +backup_recovery_password_hash")
      .lean();
    if (!settings?.backup_recovery_password_salt || !settings?.backup_recovery_password_hash) {
      return res.status(428).json({ success: false, message: "Configure a backup recovery password before restoring." });
    }

    const validRecoveryPassword = await verifyBackupRecoveryPassword(
      req.body?.recovery_password,
      settings.backup_recovery_password_salt,
      settings.backup_recovery_password_hash,
    );
    if (!validRecoveryPassword) {
      await recordBackupOperation(req, "restore", "failed", { id: req.params.backupId }, "Recovery password verification failed.");
      return res.status(403).json({ success: false, message: "The recovery password is incorrect." });
    }

    const backupRecord = await SystemSetting.findOne({ key: "global" }).select("backup_history").lean();
    backup = backupRecord?.backup_history?.find((item) => item.id === req.params.backupId) || { id: req.params.backupId };
    await recordBackupOperation(req, "restore", "started", backup, "Restore started.");
    const result = await restoreSystemBackup(req.params.backupId, req.body?.recovery_password);
    await recordBackupOperation(req, "restore", "success", backup, "Restore completed; all sessions revoked.");
    res.json({ success: true, ...result });
  } catch (error) {
    await recordBackupOperation(req, "restore", "failed", backup || { id: req.params.backupId }, error.message || "Restore failed.");
    console.error("Restore system backup error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to restore backup." });
  }
});

router.delete("/system-settings/backups/:backupId", authMiddleware, roleMiddleware(["admin", "super_admin", "skilled_worker"]), staffModulePermission("settings", "back_up"), async (req, res) => {
  try {
    const result = await deleteSystemBackup(req.params.backupId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Delete system backup error:", error);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to delete backup." });
  }
});

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post("/register", async (req, res) => {
  try {
    const {
      email,
      username,
      password,
      first_name,
      last_name,
      phone,
      street_address,
      city,
      province,
      zip_code,
      role,
      privacy_policy_acknowledged,
      privacy_policy_version,
      terms_and_conditions_accepted,
      terms_and_conditions_version,
    } = req.body;

    if (privacy_policy_acknowledged !== true) {
      return res.status(400).json({ success: false, message: "Please acknowledge the Privacy Policy before registering." });
    }
    if (privacy_policy_version !== CURRENT_LEGAL_DOCUMENT_VERSIONS.privacyPolicy) {
      return res.status(409).json({ success: false, message: "The Privacy Policy has been updated. Review the current notice before registering." });
    }
    if (terms_and_conditions_accepted !== true) {
      return res.status(400).json({ success: false, message: "Please agree to the Terms and Conditions before registering." });
    }
    if (terms_and_conditions_version !== CURRENT_LEGAL_DOCUMENT_VERSIONS.termsAndConditions) {
      return res.status(409).json({ success: false, message: "The Terms and Conditions have been updated. Review the current terms before registering." });
    }

    if (!email || !username || !password || !first_name || !last_name) {
      return res.status(400).json({
        success: false,
        message: "Email, username, password, first_name, and last_name are required",
      });
    }

    if (String(first_name).trim().length > 50 || String(last_name).trim().length > 50) {
      return res.status(400).json({ success: false, message: "First name and last name cannot exceed 50 characters each." });
    }

    if (typeof city === "string" && city.trim().length > 40) {
      return res.status(400).json({ success: false, message: "City cannot exceed 40 characters." });
    }
    if (typeof province === "string" && province.trim().length > 40) {
      return res.status(400).json({ success: false, message: "Province cannot exceed 40 characters." });
    }
    if (zip_code !== undefined && zip_code !== null && String(zip_code).trim() && !/^\d{1,4}$/.test(String(zip_code).trim())) {
      return res.status(400).json({ success: false, message: "Zip Code must contain up to 4 digits." });
    }

    const normalizedStreetAddress = normalizeFullAddress(street_address);
    const addressError = getStreetAddressError(normalizedStreetAddress);
    if (addressError) return res.status(400).json({ success: false, message: addressError });

    if (!/^[a-zA-Z0-9._-]{6,12}$/.test(String(username).trim())) {
      return res.status(400).json({
        success: false,
        message: "Use a username with 6-12 letters, numbers, dots, underscores, or hyphens.",
      });
    }

    if (!isPasswordPolicySatisfied(password)) {
      return res.status(400).json({ success: false, message: PASSWORD_POLICY_MESSAGE });
    }

    const [existingUser, adminExists] = await Promise.all([
      User.findOne({
        $or: [{ email: email.toLowerCase().trim() }, { username: username.toLowerCase().trim() }],
      }),
      findValidAdministrator(),
    ]);

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "A user already exists with that email or username",
      });
    }

    if (!adminExists) {
      return res.status(403).json({
        success: false,
        message:
          "An admin account must be created first. Please create the admin account before registering customers.",
      });
    }

    const verificationToken = randomBytes(32).toString("hex");
    const user = new User({
      email,
      username,
      password,
      first_name,
      last_name,
      phone: phone || "",
      street_address: normalizedStreetAddress,
      city: city || "",
      province: province || "",
      zip_code: zip_code || "",
      role: "customer",
      email_verified: false,
      email_verification_token: hashVerificationToken(verificationToken),
      email_verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const legalDocumentsAcceptedAt = new Date();
    user.privacy_policy_acknowledgments = [{
      account_id: user._id,
      document_version: privacy_policy_version,
      acknowledged_at: legalDocumentsAcceptedAt,
    }];
    user.terms_and_conditions_acceptances = [{
      account_id: user._id,
      document_version: terms_and_conditions_version,
      accepted_at: legalDocumentsAcceptedAt,
    }];

    await user.save();

    try {
      await sendVerificationEmail(user, verificationToken);
    } catch (mailError) {
      await User.deleteOne({ _id: user._id });
      console.error("Registration verification email failed:", mailError);
      return res.status(502).json({
        success: false,
        message: "We couldn't send the verification email. Please check the mail service configuration and try again.",
      });
    }

    res.status(201).json({
      success: true,
      message: "Registration successful. Check your email to verify your account.",
      email: user.email,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "Error registering user",
    });
  }
});

/**
 * GET /api/auth/verify-email
 * Verify a customer email address with a one-time token.
 */
router.get("/verify-email", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) {
      return res.status(400).json({ success: false, message: "Verification token is required." });
    }

    const user = await User.findOne({
      email_verification_token: hashVerificationToken(token),
      email_verification_expires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "This verification link is invalid or expired." });
    }

    user.email_verified = true;
    user.email_verification_token = null;
    user.email_verification_expires = null;
    await user.save();

    return res.json({ success: true, message: "Email verified successfully. You can now log in." });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "This email address is already registered to another account." });
    }
    console.error("Email verification error:", error);
    return res.status(500).json({ success: false, message: "Unable to verify email." });
  }
});

router.post("/profile/email-change", authMiddleware, staffModulePermissionIfStaff("profile", "edit"), async (req, res) => {
  try {
    const newEmail = String(req.body?.new_email || "").trim().toLowerCase();
    const currentPassword = String(req.body?.current_password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }
    if (!currentPassword) {
      return res.status(400).json({ success: false, message: "Current password is required." });
    }

    const { account } = await getProfileEmailChangeAccount(req);
    if (!account) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }
    if (!(await account.comparePassword(currentPassword))) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }
    if (newEmail === account.email.toLowerCase()) {
      return res.status(400).json({ success: false, message: "The new email address matches your current email." });
    }

    if (await hasEmailChangeConflict(newEmail, account, AccountModel)) {
      return res.status(409).json({ success: false, message: "This email address is already registered or pending verification for another account." });
    }

    account.pending_email = newEmail;
    account.pending_email_verification_code = null;
    account.pending_email_verification_expires = null;
    account.pending_email_verification_attempts = 0;
    account.pending_email_verification_sent_at = null;

    try {
      await createEmailChangeCode(account, newEmail);
    } catch (mailError) {
      await AccountModel.updateOne(
        { _id: account._id, pending_email: newEmail },
        { $set: {
          pending_email: null,
          pending_email_verification_code: null,
          pending_email_verification_expires: null,
          pending_email_verification_attempts: 0,
          pending_email_verification_sent_at: null,
        } },
      );
      return res.status(502).json({ success: false, message: "Unable to send the verification code. Your current email is unchanged." });
    }

    return res.json({
      success: true,
      pending_email: newEmail,
      message: `A verification code was sent to ${newEmail}. Your current email remains active until verified.`,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "This email address is already registered or pending verification for another account." });
    }
    console.error("Request email change error:", error);
    return res.status(500).json({ success: false, message: "Unable to request an email change." });
  }
});

router.post("/profile/email-change/resend", authMiddleware, staffModulePermissionIfStaff("profile", "edit"), async (req, res) => {
  try {
    const { account, AccountModel } = await getProfileEmailChangeAccount(req);
    if (!account) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }
    if (!account.pending_email) {
      return res.status(400).json({ success: false, message: "There is no pending email change to verify." });
    }

    const cooldownEndsAt = account.pending_email_verification_sent_at
      ? account.pending_email_verification_sent_at.getTime() + 60 * 1000
      : 0;
    if (Date.now() < cooldownEndsAt) {
      return res.status(429).json({
        success: false,
        retry_after_seconds: Math.ceil((cooldownEndsAt - Date.now()) / 1000),
        message: "Please wait before requesting another verification code.",
      });
    }

    try {
      await createEmailChangeCode(account, account.pending_email);
    } catch (mailError) {
      console.error("Email change code resend failed:", mailError);
      await AccountModel.updateOne(
        { _id: account._id, pending_email: account.pending_email },
        { $set: {
          pending_email_verification_code: null,
          pending_email_verification_expires: null,
          pending_email_verification_sent_at: null,
        } },
      );
      return res.status(502).json({ success: false, message: "Unable to send a new verification code. Please try again later." });
    }

    return res.json({ success: true, message: "A new verification code was sent." });
  } catch (error) {
    console.error("Resend email change code error:", error);
    return res.status(500).json({ success: false, message: "Unable to resend the verification code." });
  }
});

router.post("/profile/email-change/verify", authMiddleware, staffModulePermissionIfStaff("profile", "edit"), async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: "Enter the six-digit verification code." });
    }

    const { account, AccountModel } = await getProfileEmailChangeAccount(req);
    if (!account) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }
    if (!account.pending_email) {
      return res.status(400).json({ success: false, message: "There is no pending email change to verify." });
    }
    if (!account.pending_email_verification_code || !account.pending_email_verification_expires) {
      return res.status(400).json({ success: false, message: "Your verification code has expired. Request a new code to continue." });
    }
    if (account.pending_email_verification_expires <= new Date()) {
      account.pending_email_verification_code = null;
      await account.save();
      return res.status(400).json({ success: false, message: "Your verification code has expired. Request a new code to continue." });
    }
    if (account.pending_email_verification_attempts >= 5) {
      account.pending_email_verification_code = null;
      account.pending_email_verification_expires = null;
      await account.save();
      return res.status(429).json({ success: false, message: "Too many incorrect codes. Request a new code to continue." });
    }

    const expectedCodeHash = hashVerificationToken(`${account._id}:${account.pending_email}:${code}`);
    if (!verificationHashesMatch(expectedCodeHash, account.pending_email_verification_code)) {
      account.pending_email_verification_attempts += 1;
      if (account.pending_email_verification_attempts >= 5) {
        account.pending_email_verification_code = null;
        account.pending_email_verification_expires = null;
      }
      await account.save();
      const attemptsRemaining = Math.max(0, 5 - account.pending_email_verification_attempts);
      return res.status(attemptsRemaining ? 400 : 429).json({
        success: false,
        attempts_remaining: attemptsRemaining,
        message: attemptsRemaining
          ? `Incorrect verification code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`
          : "Too many incorrect codes. Request a new code to continue.",
      });
    }

    const pendingEmail = account.pending_email.toLowerCase().trim();
    if (await hasEmailChangeConflict(pendingEmail, account, AccountModel)) {
      return res.status(409).json({ success: false, message: "This email address is already registered to another account." });
    }

    account.email = pendingEmail;
    if (AccountModel === User) account.email_verified = true;
    account.pending_email = null;
    account.pending_email_verification_code = null;
    account.pending_email_verification_expires = null;
    account.pending_email_verification_attempts = 0;
    account.pending_email_verification_sent_at = null;
    await account.save();

    return res.json({ success: true, email: account.email, message: "Your email address has been updated and verified successfully." });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "This email address is already registered to another account." });
    }
    console.error("Verify email change code error:", error);
    return res.status(500).json({ success: false, message: "Unable to verify the code." });
  }
});

router.post("/profile/username-change/request-code", authMiddleware, staffModulePermissionIfStaff("profile", "edit"), async (req, res) => {
  try {
    const currentPassword = String(req.body?.current_password || "");
    if (!currentPassword) return res.status(400).json({ success: false, message: "Current password is required." });

    const { account, AccountModel } = await getProfileEmailChangeAccount(req);
    if (!account) return res.status(404).json({ success: false, message: "Account not found." });
    if (!(await account.comparePassword(currentPassword))) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }
    const requestCooldownEndsAt = account.pending_username_verification_sent_at
      ? account.pending_username_verification_sent_at.getTime() + 30 * 1000
      : 0;
    if (Date.now() < requestCooldownEndsAt) {
      return res.status(429).json({
        success: false,
        retry_after_seconds: Math.ceil((requestCooldownEndsAt - Date.now()) / 1000),
        message: "Please wait before requesting another verification code.",
      });
    }
    account.pending_username = null;
    account.pending_username_verification_code = null;
    account.pending_username_verification_expires = null;
    account.pending_username_verification_attempts = 0;
    account.pending_username_verification_sent_at = null;
    account.username_change_verified_until = null;
    try {
      await createUsernameChangeCode(account);
    } catch (mailError) {
      await AccountModel.updateOne(
        { _id: account._id },
        { $set: {
          pending_username_verification_code: null,
          pending_username_verification_expires: null,
          pending_username_verification_attempts: 0,
          pending_username_verification_sent_at: null,
        } },
      );
      return res.status(502).json({ success: false, message: "Unable to send the verification code. Your current username is unchanged." });
    }

    return res.json({ success: true, verification_email: account.email });
  } catch (error) {
    console.error("Request username change error:", error);
    return res.status(500).json({ success: false, message: "Unable to request a username change." });
  }
});

router.post("/profile/username-change/resend", authMiddleware, staffModulePermissionIfStaff("profile", "edit"), async (req, res) => {
  try {
    const { account } = await getProfileEmailChangeAccount(req);
    if (!account) return res.status(404).json({ success: false, message: "Account not found." });
    if (!account.pending_username_verification_code) return res.status(400).json({ success: false, message: "Request a verification code before resending it." });

    const cooldownEndsAt = account.pending_username_verification_sent_at
      ? account.pending_username_verification_sent_at.getTime() + 30 * 1000
      : 0;
    if (Date.now() < cooldownEndsAt) {
      return res.status(429).json({
        success: false,
        retry_after_seconds: Math.ceil((cooldownEndsAt - Date.now()) / 1000),
        message: "Please wait before requesting another verification code.",
      });
    }

    try {
      await createUsernameChangeCode(account);
    } catch (mailError) {
      const AccountModel = account.constructor;
      await AccountModel.updateOne(
        { _id: account._id },
        { $set: {
          pending_username_verification_code: null,
          pending_username_verification_expires: null,
          pending_username_verification_sent_at: null,
        } },
      );
      return res.status(502).json({ success: false, message: "Unable to send a new verification code. Please try again later." });
    }
    return res.json({ success: true, message: "A new verification code was sent." });
  } catch (error) {
    console.error("Resend username change code error:", error);
    return res.status(500).json({ success: false, message: "Unable to resend the verification code." });
  }
});

router.post("/profile/username-change/verify", authMiddleware, staffModulePermissionIfStaff("profile", "edit"), async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: "Enter the six-digit verification code." });
    const { account } = await getProfileEmailChangeAccount(req);
    if (!account) return res.status(404).json({ success: false, message: "Account not found." });
    if (!account.pending_username_verification_code || !account.pending_username_verification_expires) {
      return res.status(400).json({ success: false, message: "Your verification code has expired. Request a new code to continue." });
    }
    if (account.pending_username_verification_expires <= new Date()) {
      account.pending_username_verification_code = null;
      await account.save();
      return res.status(400).json({ success: false, message: "Your verification code has expired. Request a new code to continue." });
    }
    if (account.pending_username_verification_attempts >= 5) {
      account.pending_username_verification_code = null;
      account.pending_username_verification_expires = null;
      await account.save();
      return res.status(429).json({ success: false, message: "Too many incorrect codes. Request a new code to continue." });
    }

    const expectedCodeHash = hashVerificationToken(`${account._id}:username-change:${code}`);
    if (!verificationHashesMatch(expectedCodeHash, account.pending_username_verification_code)) {
      account.pending_username_verification_attempts += 1;
      if (account.pending_username_verification_attempts >= 5) {
        account.pending_username_verification_code = null;
        account.pending_username_verification_expires = null;
      }
      await account.save();
      const attemptsRemaining = Math.max(0, 5 - account.pending_username_verification_attempts);
      return res.status(attemptsRemaining ? 400 : 429).json({
        success: false,
        attempts_remaining: attemptsRemaining,
        message: attemptsRemaining
          ? `Incorrect verification code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`
          : "Too many incorrect codes. Request a new code to continue.",
      });
    }

    account.pending_username_verification_code = null;
    account.pending_username_verification_expires = null;
    account.pending_username_verification_attempts = 0;
    account.pending_username_verification_sent_at = null;
    account.username_change_verified_until = new Date(Date.now() + 10 * 60 * 1000);
    await account.save();
    return res.json({ success: true, message: "Email verified. You can now choose a new username." });
  } catch (error) {
    console.error("Verify username change code error:", error);
    return res.status(500).json({ success: false, message: "Unable to verify the code." });
  }
});

router.post("/profile/username-change/complete", authMiddleware, staffModulePermissionIfStaff("profile", "edit"), async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{6,12}$/.test(username)) {
      return res.status(400).json({ success: false, message: "Use a username with 6-12 letters, numbers, dots, underscores, or hyphens." });
    }
    const { account, AccountModel } = await getProfileEmailChangeAccount(req);
    if (!account) return res.status(404).json({ success: false, message: "Account not found." });
    if (!account.username_change_verified_until || account.username_change_verified_until <= new Date()) {
      account.username_change_verified_until = null;
      await account.save();
      return res.status(400).json({ success: false, message: "Verify the code sent to your email before choosing a username." });
    }
    if (username === String(account.username || "").toLowerCase()) {
      return res.status(400).json({ success: false, message: "The new username matches your current username." });
    }
    if (await hasUsernameChangeConflict(username, account, AccountModel)) {
      return res.status(409).json({ success: false, message: "That username is already in use. Choose another username." });
    }

    account.username = username;
    account.username_change_verified_until = null;
    await account.save();
    return res.json({ success: true, username: account.username, message: "Your username has been updated successfully." });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "That username is already in use. Choose another username." });
    console.error("Complete username change error:", error);
    return res.status(500).json({ success: false, message: "Unable to update your username." });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const [admin, user] = await Promise.all([
      Admin.findOne({ email }),
      User.findOne({ email }),
    ]);
    const account = admin || user;

    if (!account) {
      return res.status(404).json({ success: false, message: "The email address you entered does not match any existing account. Please verify it and try again." });
    }

    let responseAccount = account;
    if (account) {
      const Model = admin ? Admin : User;
      const reservedAccount = await reservePasswordResetRequest(Model, account._id);
      if (reservedAccount) {
        const code = String(randomInt(100000, 1000000));
        try {
          await sendPasswordResetCode(reservedAccount, code);
          const sentAt = new Date();
          const activeAccount = await Model.findOneAndUpdate({
            _id: reservedAccount._id,
            password_reset_request_lock_until: reservedAccount.password_reset_request_lock_until,
          }, {
            $set: {
              password_reset_code: hashVerificationToken(`${reservedAccount._id}:${code}`),
              password_reset_expires: new Date(sentAt.getTime() + PASSWORD_RESET_TTL_MS),
              password_reset_sent_at: sentAt,
              password_reset_attempts: 0,
              password_reset_request_lock_until: null,
            },
          }, { new: true });
          if (!activeAccount) throw new Error("Password reset request was superseded.");
          responseAccount = activeAccount;
        } catch (sendError) {
          await Model.updateOne(
            { _id: reservedAccount._id, password_reset_request_lock_until: reservedAccount.password_reset_request_lock_until },
            { $set: { password_reset_request_lock_until: null } },
          );
          throw sendError;
        }
      } else {
        responseAccount = await Model.findById(account._id);
      }
    }

    return res.json({
      success: true,
      message: "If an account exists for that email, a verification code has been sent.",
      ...getPasswordResetTiming(responseAccount),
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ success: false, message: "Unable to send the reset code." });
  }
});

router.post("/resend-reset-code", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: "Email is required." });

    const [admin, user] = await Promise.all([
      Admin.findOne({ email }),
      User.findOne({ email }),
    ]);
    const account = admin || user;
    if (!account) {
      return res.json({
        success: true,
        message: "If an account exists for that email, a verification code has been sent.",
        ...getPasswordResetTiming(null),
      });
    }

    const Model = admin ? Admin : User;
    const reservedAccount = await reservePasswordResetRequest(Model, account._id);
    if (!reservedAccount) {
      const latestAccount = await Model.findById(account._id);
      const now = new Date();
      return res.status(429).json({
        success: false,
        retry_after_seconds: getPasswordResetRetrySeconds(latestAccount || account, now),
        retry_available_at: new Date(now.getTime() + getPasswordResetRetrySeconds(latestAccount || account, now) * 1000).toISOString(),
        serverNow: now.toISOString(),
        message: "Please wait before requesting another code.",
      });
    }

    const code = String(randomInt(100000, 1000000));
    try {
      await sendPasswordResetCode(reservedAccount, code);
      const sentAt = new Date();
      const activeAccount = await Model.findOneAndUpdate({
        _id: reservedAccount._id,
        password_reset_request_lock_until: reservedAccount.password_reset_request_lock_until,
      }, {
        $set: {
          password_reset_code: hashVerificationToken(`${reservedAccount._id}:${code}`),
          password_reset_expires: new Date(sentAt.getTime() + PASSWORD_RESET_TTL_MS),
          password_reset_sent_at: sentAt,
          password_reset_attempts: 0,
          password_reset_request_lock_until: null,
        },
      }, { new: true });
      if (!activeAccount) throw new Error("Password reset request was superseded.");
      return res.json({
        success: true,
        message: "A new verification code was sent.",
        ...getPasswordResetTiming(activeAccount, sentAt),
      });
    } catch (sendError) {
      await Model.updateOne(
        { _id: reservedAccount._id, password_reset_request_lock_until: reservedAccount.password_reset_request_lock_until },
        { $set: { password_reset_request_lock_until: null } },
      );
      console.error("Password reset code resend failed:", sendError);
      return res.status(502).json({ success: false, message: "Unable to send a new code. Please try again later." });
    }
  } catch (error) {
    console.error("Resend password reset code error:", error);
    return res.status(500).json({ success: false, message: "Unable to resend the verification code." });
  }
});

router.post("/verify-reset-code", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: "Enter the six-digit verification code." });
    }

    const admin = await Admin.findOne({ email }).select("+password_reset_code");
    const user = admin ? null : await User.findOne({ email }).select("+password_reset_code");
    const account = admin || user;

    if (!account || !account.password_reset_code || !account.password_reset_expires) {
      return res.status(400).json({ success: false, message: "The code is invalid or expired." });
    }

    const Model = admin ? Admin : User;
    const now = new Date();
    if (account.password_reset_expires <= now) {
      await Model.updateOne(
        { _id: account._id, password_reset_expires: { $lte: now } },
        { $set: { password_reset_code: null, password_reset_expires: null } },
      );
      return res.status(400).json({ success: false, message: "Your verification code has expired. Please request a new code." });
    }
    if (account.password_reset_attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, message: "Too many incorrect codes. Request a new code to continue." });
    }

    const expectedCodeHash = hashVerificationToken(`${account._id}:${code}`);
    const legacyCodeHash = hashVerificationToken(code);
    const codeMatches = verificationHashesMatch(expectedCodeHash, account.password_reset_code)
      || verificationHashesMatch(legacyCodeHash, account.password_reset_code);
    if (!codeMatches) {
      const updatedAccount = await Model.findOneAndUpdate({
        _id: account._id,
        password_reset_code: account.password_reset_code,
        password_reset_expires: { $gt: now },
        $or: [
          { password_reset_attempts: { $lt: PASSWORD_RESET_MAX_ATTEMPTS } },
          { password_reset_attempts: null },
        ],
      }, { $inc: { password_reset_attempts: 1 } }, { new: true });

      if (!updatedAccount || updatedAccount.password_reset_attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
        if (updatedAccount) {
          await Model.updateOne(
            { _id: updatedAccount._id, password_reset_code: updatedAccount.password_reset_code },
            { $set: { password_reset_code: null, password_reset_expires: null } },
          );
        }
        return res.status(429).json({ success: false, attempts_remaining: 0, message: "Too many incorrect codes. Request a new code to continue." });
      }

      const attemptsRemaining = PASSWORD_RESET_MAX_ATTEMPTS - updatedAccount.password_reset_attempts;
      return res.status(400).json({
        success: false,
        attempts_remaining: attemptsRemaining,
        message: `Incorrect verification code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`,
      });
    }

    const consumedCode = await Model.findOneAndUpdate({
      _id: account._id,
      password_reset_code: account.password_reset_code,
      password_reset_expires: { $gt: now },
      $or: [
        { password_reset_attempts: { $lt: PASSWORD_RESET_MAX_ATTEMPTS } },
        { password_reset_attempts: null },
      ],
    }, {
      $set: {
        password_reset_code: null,
        password_reset_expires: null,
        password_reset_attempts: 0,
      },
    }, { new: true });
    if (!consumedCode) {
      return res.status(400).json({ success: false, message: "The code is invalid or expired." });
    }

    const resetToken = jwt.sign(
      { id: account._id, model: admin ? "admin" : "user", purpose: "password-reset" },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "10m" },
    );
    return res.json({ success: true, resetToken });
  } catch (error) {
    console.error("Verify reset code error:", error);
    return res.status(500).json({ success: false, message: "Unable to verify the reset code." });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { resetToken, password } = req.body || {};
    if (!resetToken || !isPasswordPolicySatisfied(password)) {
      return res.status(400).json({ success: false, message: `A valid reset token and a password are required. ${PASSWORD_POLICY_MESSAGE}` });
    }

    const payload = jwt.verify(resetToken, process.env.JWT_SECRET || "your-secret-key");
    if (payload.purpose !== "password-reset") {
      return res.status(400).json({ success: false, message: "Invalid password reset token." });
    }

    const Model = payload.model === "admin" ? Admin : User;
    const account = await Model.findById(payload.id);
    if (!account) {
      return res.status(400).json({ success: false, message: "Account not found." });
    }

    if (await account.comparePassword(password)) {
      return res.status(400).json({
        success: false,
        message: "You cannot reuse your previous password. Please choose a new password.",
      });
    }

    account.password = password;
    account.password_reset_code = null;
    account.password_reset_expires = null;
    account.password_reset_attempts = 0;
    await account.save();
    return res.json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(400).json({ success: false, message: "The reset session is invalid or expired." });
  }
});

/**
 * GET /api/auth/admin-exists
 * Check whether an admin user exists in the system
 */
router.get("/admin-exists", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({ exists: Boolean(await findValidAdministrator()) });
  } catch (error) {
    console.error("Admin exists check error:", error.name || "Error");
    res.status(500).json({
      success: false,
      message: "Error checking admin status",
    });
  }
});

router.get("/admin-status", async (req, res) => {
  try {
    res.json({ exists: Boolean(await findValidAdministrator()) });
  } catch (error) {
    console.error("Admin status check error:", error.name || "Error");
    res.status(500).json({
      success: false,
      message: "Error checking admin status",
    });
  }
});

router.get("/customers", authMiddleware, roleMiddleware(["admin", "super_admin", "skilled_worker"]), async (req, res) => {
  try {
    if (req.user.role === "skilled_worker") {
      const account = await User.findById(req.user.id).select("staff_access").lean();
      const modules = account?.staff_access?.modules || {};
      const canSearchForRepair = modules.repair_management?.enabled === true
        && modules.repair_management.actions?.create === true;
      const canSearchForInspection = modules.site_inspection?.enabled === true
        && modules.site_inspection.actions?.edit === true;
      if (!canSearchForRepair && !canSearchForInspection) {
        return res.status(403).json({ success: false, message: "Customer search is disabled for your staff account." });
      }
    }
    const { search } = req.query;
    if (!search || !search.trim()) {
      return res.json({ success: true, customers: [] });
    }

    const queryText = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(queryText, "i");

    const customers = await User.find({
      role: "customer",
      $or: [
        { first_name: regex },
        { last_name: regex },
        { email: regex },
        { username: regex },
        { phone: regex },
      ],
    })
      .select("first_name last_name email phone street_address city province zip_code customer_cancellation_count online_order_cooldown_until")
      .limit(10)
      .lean();

    res.json({ success: true, customers });
  } catch (error) {
    console.error("Customer search error:", error);
    res.status(500).json({ success: false, message: "Unable to search customers", error: error.message });
  }
});

router.get("/users", authMiddleware, staffModulePermission("settings", "view"), async (req, res) => {
  try {
    const { role, search } = req.query;
    const query = {};
    const requestedRole = role === "staff" ? "skilled_worker" : role;

    if (requestedRole && requestedRole !== "all") query.role = requestedRole;
    let searchRegex;
    if (search?.trim()) {
      const queryText = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      searchRegex = new RegExp(queryText, "i");
      query.$or = [{ first_name: searchRegex }, { last_name: searchRegex }, { email: searchRegex }, { username: searchRegex }];
    }

    const users = await User.find(query).select("-password").sort({ createdAt: -1 });
    const adminQuery = requestedRole && requestedRole !== "all" && requestedRole !== "admin"
      ? null
      : searchRegex
        ? { $or: [{ first_name: searchRegex }, { last_name: searchRegex }, { email: searchRegex }, { username: searchRegex }] }
        : {};
    const adminAccounts = adminQuery
      ? await Admin.find(adminQuery).select("-password -password_reset_code -password_reset_expires").lean()
      : [];
    const userIds = new Set(users.map((account) => String(account._id)));
    const allAccounts = [
      ...users,
      ...adminAccounts
        .filter((account) => !userIds.has(String(account._id)))
        .map((account) => ({ ...account, role: "admin", is_admin_account: true })),
    ].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));

    if (["admin", "super_admin"].includes(req.user.role)) {
      await Promise.all(allAccounts
        .filter((account) => account.role === "skilled_worker" && Number(account.staff_access?.profile_version || 0) < 2)
        .map(async (account) => {
          account.staff_access = migrateStaffAccess(account.staff_access);
          account.markModified("staff_access");
          await account.save();
        }));
    }
    res.json({ success: true, users: allAccounts });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ success: false, message: "Unable to load users." });
  }
});

router.patch("/users/:id/unrestrict-online-ordering", authMiddleware, async (req, res) => {
  if (!(["admin", "super_admin"].includes(req.user.role))) {
    return res.status(403).json({ success: false, message: "Only administrators can remove a customer's online ordering restriction." });
  }

  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: "customer" },
      { $set: { online_order_cooldown_until: null } },
      { new: true, runValidators: true },
    ).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "Customer account not found." });

    return res.json({
      success: true,
      user,
      message: "The customer's 7-day online ordering restriction has been removed.",
    });
  } catch (error) {
    console.error("Remove customer online ordering restriction error:", error);
    return res.status(500).json({ success: false, message: "Unable to remove the online ordering restriction." });
  }
});

router.post("/users/:id/promote-super-admin", authMiddleware, async (req, res) => {
  const maxSuperAdminsMessage = "The maximum limit of 2 Super Admin accounts has been reached. Demote an existing Super Admin before promoting another staff member.";
  let promotionLockId = null;
  let auditRecord = null;
  let promotedUser = null;
  let promotionStarted = false;
  let actor = null;
  let target = null;
  let promotionStep = "authorization";

  const recordRejection = async (reason) => {
    if (!actor || !target) return;
    try {
      await SuperAdminPromotionAudit.create({
        action: "staff_promoted_to_super_admin",
        outcome: "rejected",
        actor_id: actor._id,
        actor_email: actor.email,
        target_id: target._id,
        target_email: target.email,
        previous_role: target.role || "unknown",
        new_role: "super_admin",
        reason,
      });
    } catch (auditError) {
      console.error("Unable to record rejected Super Admin promotion:", auditError.message);
    }
  };

  try {
    const authorizedSuperAdmin = (req.user.auth_source === "admin" && req.user.role === "admin")
      || (req.user.auth_source === "user" && ["admin", "super_admin"].includes(req.user.role));
    if (!authorizedSuperAdmin) {
      return res.status(403).json({ success: false, message: "Only a Super Admin can promote staff accounts." });
    }

    const password = req.body?.current_password;
    if (typeof password !== "string" || !password) {
      return res.status(400).json({ success: false, message: "Enter your current password to confirm this promotion." });
    }
    promotionStep = "verify_actor_password";
    const ActorModel = req.user.auth_source === "admin" ? Admin : User;
    actor = await ActorModel.findById(req.user.id).select("password email first_name last_name is_active role");
    if (!actor || actor.is_active === false || typeof actor.password !== "string" || !await actor.comparePassword(password)) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "The selected staff account is invalid." });
    }
    promotionStep = "load_target_staff_account";
    target = await User.findById(req.params.id).select("email username first_name last_name role is_active").lean();
    if (!target) return res.status(404).json({ success: false, message: "Staff account not found." });
    if (String(target._id) === String(actor._id)) {
      await recordRejection("self_promotion_blocked");
      return res.status(400).json({ success: false, message: "You cannot promote your own account through staff management." });
    }
    if (target.role !== "skilled_worker") {
      await recordRejection(target.role === "super_admin" || target.role === "admin" ? "already_super_admin" : "target_not_staff");
      return res.status(409).json({ success: false, message: target.role === "super_admin" || target.role === "admin" ? "This account is already a Super Admin." : "Only an existing staff account can be promoted." });
    }
    if (target.is_active === false) {
      await recordRejection("target_account_inactive");
      return res.status(409).json({ success: false, message: "An inactive staff account cannot be promoted." });
    }
    promotionStep = "check_duplicate_admin_account";
    const duplicateAdmin = await Admin.findOne({ $or: [{ email: target.email }, { username: target.username }] }).select("_id").lean();
    if (duplicateAdmin) {
      await recordRejection("duplicate_admin_account");
      return res.status(409).json({ success: false, message: "A Super Admin account already exists for this staff identity." });
    }

    promotionLockId = randomBytes(16).toString("hex");
    const lockNow = new Date();
    promotionStep = "acquire_promotion_lock";
    try {
      const lock = await SystemSetting.findOneAndUpdate(
        {
          key: "global",
          $or: [
            { super_admin_promotion_lock: null },
            { "super_admin_promotion_lock.expires_at": { $lte: lockNow } },
          ],
        },
        {
          $set: { super_admin_promotion_lock: { lock_id: promotionLockId, expires_at: new Date(lockNow.getTime() + SUPER_ADMIN_PROMOTION_LOCK_TTL_MS) } },
        },
        // Defaults would also add super_admin_promotion_lock: null on insert,
        // conflicting with the explicit lock value in $set.
        { returnDocument: "after", upsert: true, setDefaultsOnInsert: false },
      ).select("_id").lean();
      if (!lock) return res.status(409).json({ success: false, message: "Another Super Admin promotion is being processed. Try again shortly." });
    } catch (lockError) {
      if (lockError?.code === 11000) return res.status(409).json({ success: false, message: "Another Super Admin promotion is being processed. Try again shortly." });
      throw lockError;
    }

    promotionStep = "count_active_super_admins";
    const activeSuperAdminCount = await countActiveSuperAdmins();
    if (activeSuperAdminCount >= MAX_ACTIVE_SUPER_ADMINS) {
      await recordRejection("active_super_admin_limit_reached");
      return res.status(409).json({ success: false, message: maxSuperAdminsMessage });
    }

    promotionStep = "create_promotion_audit";
    auditRecord = await SuperAdminPromotionAudit.create({
      action: "staff_promoted_to_super_admin",
      outcome: "initiated",
      actor_id: actor._id,
      actor_email: actor.email,
      target_id: target._id,
      target_email: target.email,
      previous_role: target.role,
      new_role: "super_admin",
    });

    promotionStep = "update_staff_role";
    promotedUser = await User.findOneAndUpdate(
      { _id: target._id, role: "skilled_worker", is_active: { $ne: false } },
      { $set: { role: "super_admin" }, $inc: { session_version: 1 } },
      { new: true, runValidators: true },
    ).select("-password");
    if (!promotedUser) {
      await auditRecord.updateOne({ $set: { outcome: "rejected", reason: "target_changed_before_promotion" } });
      return res.status(409).json({ success: false, message: "The staff account changed before it could be promoted. Refresh and try again." });
    }
    promotionStarted = true;

    promotionStep = "complete_promotion_audit";
    await auditRecord.updateOne({ $set: { outcome: "succeeded" } });
    res.json({ success: true, user: promotedUser, message: "Staff member promoted to Super Admin." });
  } catch (error) {
    if (promotionStarted && promotedUser) {
      try {
        await User.updateOne(
          { _id: promotedUser._id, role: "super_admin", session_version: promotedUser.session_version },
          { $set: { role: "skilled_worker" }, $inc: { session_version: 1 } },
        );
      } catch (rollbackError) {
        console.error("Unable to roll back a Super Admin promotion after an audit failure:", rollbackError.message);
      }
    }
    if (auditRecord) {
      await auditRecord.updateOne({ $set: { outcome: "rejected", reason: "promotion_update_failed" } }).catch((auditError) => {
        console.error("Unable to record failed Super Admin promotion:", auditError.message);
      });
    }
    console.error(`Promote staff to Super Admin error during ${promotionStep}:`, error);
    const message = process.env.NODE_ENV === "production"
      ? "Unable to promote the staff account."
      : `Unable to promote the staff account (${promotionStep}: ${error.message}).`;
    return res.status(500).json({ success: false, message });
  } finally {
    if (promotionLockId) {
      await SystemSetting.updateOne(
        { key: "global", "super_admin_promotion_lock.lock_id": promotionLockId },
        { $set: { super_admin_promotion_lock: null } },
      ).catch((error) => console.error("Unable to release Super Admin promotion lock:", error.message));
    }
  }
});

router.post("/users/:id/demote-super-admin", authMiddleware, async (req, res) => {
  let lockId = null;
  let auditRecord = null;
  let demotedUser = null;
  let demotionStarted = false;
  let actor = null;
  let target = null;

  const recordRejection = async (reason) => {
    if (!actor || !target) return;
    try {
      await SuperAdminPromotionAudit.create({
        action: "super_admin_demoted_to_staff",
        outcome: "rejected",
        actor_id: actor._id,
        actor_email: actor.email,
        target_id: target._id,
        target_email: target.email,
        previous_role: target.role || "unknown",
        new_role: "skilled_worker",
        reason,
      });
    } catch (auditError) {
      console.error("Unable to record rejected Super Admin demotion:", auditError.message);
    }
  };

  try {
    if (req.user.auth_source !== "admin" || req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only the primary Super Admin can convert another Super Admin to staff." });
    }
    if (String(req.user.id) !== await getPrimarySuperAdminId()) {
      return res.status(403).json({ success: false, message: "Only the primary Super Admin can convert another Super Admin to staff." });
    }

    const password = req.body?.current_password;
    if (typeof password !== "string" || !password) {
      return res.status(400).json({ success: false, message: "Enter your current password to confirm this role change." });
    }
    actor = await Admin.findById(req.user.id).select("password email first_name last_name is_active role");
    if (!actor || actor.is_active === false || typeof actor.password !== "string" || !await actor.comparePassword(password)) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "The selected Super Admin account is invalid." });
    }

    target = await User.findById(req.params.id).select("email first_name last_name role is_active").lean();
    if (!target) return res.status(404).json({ success: false, message: "Super Admin account not found." });
    if (String(target._id) === String(actor._id)) {
      await recordRejection("primary_self_demotion_blocked");
      return res.status(400).json({ success: false, message: "The primary Super Admin cannot be converted to staff here." });
    }
    if (target.role !== "super_admin") {
      await recordRejection("target_not_promoted_super_admin");
      return res.status(409).json({ success: false, message: "Only the promoted Super Admin account can be converted to staff here." });
    }
    if (target.is_active === false) {
      await recordRejection("target_account_inactive");
      return res.status(409).json({ success: false, message: "An inactive Super Admin account cannot be converted to staff." });
    }

    lockId = randomBytes(16).toString("hex");
    const now = new Date();
    let lock;
    try {
      lock = await SystemSetting.findOneAndUpdate(
        {
          key: "global",
          $or: [
            { super_admin_promotion_lock: null },
            { "super_admin_promotion_lock.expires_at": { $lte: now } },
          ],
        },
        { $set: { super_admin_promotion_lock: { lock_id: lockId, expires_at: new Date(now.getTime() + SUPER_ADMIN_PROMOTION_LOCK_TTL_MS) } } },
        { returnDocument: "after", upsert: true, setDefaultsOnInsert: false },
      ).select("_id").lean();
    } catch (lockError) {
      if (lockError?.code === 11000) {
        return res.status(409).json({ success: false, message: "Another Super Admin role change is being processed. Try again shortly." });
      }
      throw lockError;
    }
    if (!lock) return res.status(409).json({ success: false, message: "Another Super Admin role change is being processed. Try again shortly." });

    const activeSuperAdminCount = await countActiveSuperAdmins();
    if (activeSuperAdminCount <= 1) {
      await recordRejection("last_active_super_admin_protected");
      return res.status(409).json({ success: false, message: "At least one active Super Admin must remain." });
    }

    auditRecord = await SuperAdminPromotionAudit.create({
      action: "super_admin_demoted_to_staff",
      outcome: "initiated",
      actor_id: actor._id,
      actor_email: actor.email,
      target_id: target._id,
      target_email: target.email,
      previous_role: "super_admin",
      new_role: "skilled_worker",
    });

    demotedUser = await User.findOneAndUpdate(
      { _id: target._id, role: "super_admin", is_active: { $ne: false } },
      { $set: { role: "skilled_worker" }, $inc: { session_version: 1 } },
      { new: true, runValidators: true },
    ).select("-password");
    if (!demotedUser) {
      await auditRecord.updateOne({ $set: { outcome: "rejected", reason: "target_changed_before_demotion" } });
      return res.status(409).json({ success: false, message: "The Super Admin account changed before it could be converted. Refresh and try again." });
    }
    demotionStarted = true;

    await auditRecord.updateOne({ $set: { outcome: "succeeded" } });
    return res.json({ success: true, user: demotedUser, message: "Super Admin converted to staff." });
  } catch (error) {
    if (demotionStarted && demotedUser) {
      await User.updateOne(
        { _id: demotedUser._id, role: "skilled_worker", session_version: demotedUser.session_version },
        { $set: { role: "super_admin" }, $inc: { session_version: 1 } },
      ).catch((rollbackError) => console.error("Unable to roll back a Super Admin demotion after an audit failure:", rollbackError.message));
    }
    if (auditRecord) {
      await auditRecord.updateOne({ $set: { outcome: "rejected", reason: "demotion_update_failed" } }).catch((auditError) => {
        console.error("Unable to record failed Super Admin demotion:", auditError.message);
      });
    }
    console.error("Convert promoted Super Admin to staff error:", error);
    return res.status(500).json({ success: false, message: "Unable to convert the Super Admin account to staff." });
  } finally {
    if (lockId) {
      await SystemSetting.updateOne(
        { key: "global", "super_admin_promotion_lock.lock_id": lockId },
        { $set: { super_admin_promotion_lock: null } },
      ).catch((error) => console.error("Unable to release Super Admin role change lock:", error.message));
    }
  }
});

router.patch("/users/:id", authMiddleware, staffModulePermission("settings", "manage_access"), async (req, res) => {
  try {
    const staffPromotingCustomer = req.user.role === "skilled_worker" && req.body?.role === "skilled_worker";
    const staffConvertingToCustomer = req.user.role === "skilled_worker" && req.body?.role === "customer";
    if (req.user.role === "skilled_worker" && ((req.body?.role !== undefined && !staffPromotingCustomer && !staffConvertingToCustomer) || req.body?.staff_access !== undefined)) {
      return res.status(403).json({ success: false, message: "Staff can only promote customers or convert staff accounts to customers." });
    }
    if ((staffPromotingCustomer || staffConvertingToCustomer) && String(req.user.id) === String(req.params.id)) {
      return res.status(403).json({ success: false, message: "You cannot change your own account role." });
    }
    if (req.body?.role !== undefined && !["customer", "skilled_worker"].includes(req.body.role)) {
      return res.status(400).json({ success: false, message: "Only customer and staff role changes are allowed here." });
    }
    const requestedStaffType = req.body?.staff_access?.staff_type;
    if (requestedStaffType !== undefined && !STAFF_TYPES.includes(requestedStaffType)) {
      return res.status(400).json({ success: false, message: "Staff type must be Skilled Worker or Helper." });
    }
    if (req.body?.role === "skilled_worker" && !STAFF_TYPES.includes(requestedStaffType)) {
      return res.status(400).json({ success: false, message: "Select a staff type before converting this account." });
    }

    const allowedFields = [
      "can_request_orders",
      "can_estimate_pricing",
      "view_only_access",
      "can_track_products",
      "can_upload_feedback",
      "show_ratings_homepage",
    ];
    const permissionValues = Object.fromEntries(
      allowedFields
        .filter((field) => typeof req.body?.[field] === "boolean")
        .map((field) => [`access_permissions.${field}`, req.body[field]])
    );
    const permissions = { ...permissionValues };
    if (req.body?.view_only_access === true) {
      allowedFields
        .filter((field) => field !== "view_only_access")
        .forEach((field) => {
          permissions[`access_permissions.${field}`] = false;
        });
    }
    const update = {};
    if (Object.keys(permissions).length > 0) Object.assign(update, permissions);
    if (req.body?.role === "skilled_worker") {
      update.role = "skilled_worker";
      update.staff_access = migrateStaffAccess(
        staffPromotingCustomer
          ? { ...req.staffAccess, staff_type: requestedStaffType }
          : req.body.staff_access || createDefaultStaffAccess()
      );
    }
    if (req.body?.role === "customer") update.role = "customer";
    if (update.role) update.$inc = { session_version: 1 };
    if (req.body?.staff_access && typeof req.body.staff_access === "object") {
      const existingStaff = await User.findOne({ _id: req.params.id, role: "skilled_worker" }).select("staff_access").lean();
      update.staff_access = sanitizeStaffAccess({
        ...(existingStaff?.staff_access || {}),
        ...req.body.staff_access,
        profile_version: 2,
      });
    }

    const userFilter = req.user.role === "skilled_worker"
      ? { _id: req.params.id, role: staffConvertingToCustomer ? "skilled_worker" : "customer" }
      : update.role === "skilled_worker"
      ? { _id: req.params.id, role: "customer" }
      : update.role === "customer"
        ? { _id: req.params.id, role: "skilled_worker" }
        : update.staff_access
          ? { _id: req.params.id, role: "skilled_worker" }
          : { _id: req.params.id };
    const user = await User.findOneAndUpdate(userFilter, update, { new: true, runValidators: true }).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    res.json({ success: true, user });
  } catch (error) {
    console.error("Update user access error:", error);
    res.status(500).json({ success: false, message: "Unable to update user access." });
  }
});

router.post("/create-admin", (_req, res) => res.status(410).json({
  success: false,
  message: "Public administrator creation is disabled. Use the configured recovery procedure or trusted server-side provisioning.",
}));

/**
 * POST /api/auth/login
 * Login user
 */
router.post("/login", async (req, res) => {
  console.info("[auth] POST /api/auth/login");
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "Email/username and password are required",
      });
    }

    const query = identifier.includes("@")
      ? { email: identifier.toLowerCase().trim() }
      : { username: identifier.toLowerCase().trim() };

    let user = await User.findOne({ ...query, role: "skilled_worker" });
    let source = "user";

    if (!user) {
      user = await Admin.findOne(query);
      source = "admin";
    }

    if (!user) {
      user = await User.findOne(query);
      source = "user";
    }

    if (!user) {
      console.warn(`[auth] User not found for identifier: ${identifier} (query: ${JSON.stringify(query)})`);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    console.info(`[auth] Found user: ${user.email} (${user.username}), source: ${source}`);

    const isPasswordValid = await user.comparePassword(password);
    console.info(`[auth] Password comparison result: ${isPasswordValid}`);
    
    if (!isPasswordValid || user.is_active === false) {
      console.warn(`[auth] Invalid password for user: ${user.email}`);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (source === "user" && user.role === "skilled_worker" && Number(user.staff_access?.profile_version || 0) < 2) {
      user.staff_access = migrateStaffAccess(user.staff_access);
      user.markModified("staff_access");
      await user.save();
    }

    if (source === "user" && user.email_verification_token && user.email_verified !== true) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email address before logging in.",
      });
    }

    const role = source === "admin" ? "admin" : user.role;
    const primarySuperAdminId = source === "admin" ? await getPrimarySuperAdminId() : null;
    const token = jwt.sign(
      { id: user._id, email: user.email, role, auth_source: source, session_version: user.session_version || 0 },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role,
        is_super_admin: source === "admin" || user.role === "super_admin" || user.role === "admin",
        is_primary_super_admin: Boolean(primarySuperAdminId && String(user._id) === primarySuperAdminId),
        phone: user.phone,
        street_address: user.street_address,
        city: user.city,
        province: user.province,
        zip_code: user.zip_code,
        access_permissions: user.access_permissions,
        staff_access: user.staff_access,
        customer_cancellation_count: user.customer_cancellation_count || 0,
        online_order_cooldown_until: user.online_order_cooldown_until || null,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Error logging in",
      error: error.message,
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user session
 */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    let user = null;
    let role = req.user.role;
    let isSuperAdmin = req.user.auth_source === "admin" || role === "super_admin";
    let isPrimarySuperAdmin = false;

    if (["admin", "super_admin"].includes(role)) {
      user = await Admin.findById(req.user.id);
      if (user) {
        isSuperAdmin = true;
        isPrimarySuperAdmin = req.user.auth_source === "admin" && String(user._id) === await getPrimarySuperAdminId();
      }
      if (!user) {
        user = await User.findOne({ _id: req.user.id, role: { $in: ["admin", "super_admin"] } });
        isSuperAdmin = user?.role === "admin" || user?.role === "super_admin";
      }
    } else {
      user = await User.findById(req.user.id);
      if (!user) {
        user = await Admin.findById(req.user.id);
        role = user && role !== "super_admin" ? "admin" : role;
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    res.json({
      isAuthenticated: true,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role,
        is_super_admin: isSuperAdmin,
        is_primary_super_admin: isPrimarySuperAdmin,
        phone: user.phone,
        street_address: user.street_address,
        city: user.city,
        province: user.province,
        zip_code: user.zip_code,
        access_permissions: user.access_permissions,
        staff_access: user.staff_access,
        customer_cancellation_count: user.customer_cancellation_count || 0,
        online_order_cooldown_until: user.online_order_cooldown_until || null,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
      role,
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user",
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user (client-side, just clear token)
 */
router.post("/logout", authMiddleware, (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

/**
 * PUT /api/auth/profile
 * Update user profile
 */
router.put("/profile", authMiddleware, staffModulePermissionIfStaff("profile", "edit"), async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      phone,
      address,
      street_address,
      city,
      province,
      zip_code,
      current_password,
      new_password,
    } = req.body;

    let user = null;
    let role = req.user.role;

    if (["admin", "super_admin"].includes(role)) {
      user = await Admin.findById(req.user.id);
      if (!user) {
        user = await User.findOne({ _id: req.user.id, role: { $in: ["admin", "super_admin"] } });
      }
    } else {
      user = await User.findById(req.user.id);
      if (!user) {
        user = await Admin.findById(req.user.id);
        role = user && role !== "super_admin" ? "admin" : role;
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    if (current_password) {
      const isCurrentPasswordValid = await user.comparePassword(current_password);
      if (!isCurrentPasswordValid) {
        return res.status(401).json({ success: false, message: "Current password is incorrect" });
      }
    }

    if (new_password) {
      if (!isPasswordPolicySatisfied(new_password)) {
        return res.status(400).json({
          success: false,
          message: PASSWORD_POLICY_MESSAGE,
        });
      }

      user.password = new_password;
    }

    if (typeof first_name === "string" && first_name.trim() !== String(user.first_name || "").trim() && first_name.trim().length > 50) {
      return res.status(400).json({ success: false, message: "First name cannot exceed 50 characters." });
    }
    if (typeof last_name === "string" && last_name.trim() !== String(user.last_name || "").trim() && last_name.trim().length > 50) {
      return res.status(400).json({ success: false, message: "Last name cannot exceed 50 characters." });
    }
    if (first_name) user.first_name = first_name.trim();
    if (last_name) user.last_name = last_name.trim();
    if (phone) user.phone = phone;
    if (typeof city === "string" && city.trim() !== String(user.city || "").trim() && city.trim().length > 40) {
      return res.status(400).json({ success: false, message: "City cannot exceed 40 characters." });
    }
    if (typeof province === "string" && province.trim() !== String(user.province || "").trim() && province.trim().length > 40) {
      return res.status(400).json({ success: false, message: "Province cannot exceed 40 characters." });
    }
    if (zip_code !== undefined && String(zip_code).trim() !== String(user.zip_code || "").trim() && String(zip_code).trim() && !/^\d{1,4}$/.test(String(zip_code).trim())) {
      return res.status(400).json({ success: false, message: "Zip Code must contain up to 4 digits." });
    }
    const addressWasSubmitted = address !== undefined || street_address !== undefined;
    if (addressWasSubmitted) {
      const submittedAddress = normalizeFullAddress(street_address ?? address);
      const addressChanged = submittedAddress !== normalizeFullAddress(user.street_address);
      if (addressChanged) {
        const addressError = getStreetAddressError(submittedAddress);
        if (addressError) return res.status(400).json({ success: false, message: addressError });
        user.street_address = submittedAddress;
      }
    }
    if (city) user.city = city.trim();
    if (province) user.province = province.trim();
    if (zip_code) user.zip_code = zip_code;

    await user.save();

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role: role,
        phone: user.phone,
        street_address: user.street_address,
        city: user.city,
        province: user.province,
        zip_code: user.zip_code,
        access_permissions: user.access_permissions,
        customer_cancellation_count: user.customer_cancellation_count || 0,
        online_order_cooldown_until: user.online_order_cooldown_until || null,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error updating profile",
    });
  }
});

export default router;
