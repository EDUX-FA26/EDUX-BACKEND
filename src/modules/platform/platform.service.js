"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const platformRepository = require("./platform.repository");
const platformAuditService = require("./platformAudit.service");

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove Vietnamese accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const PlatformService = {
  // =========================================================================
  // MANAGERS
  // =========================================================================

  async listManagers() {
    return await platformRepository.listManagers();
  },

  async createManager({ email, username, password, fullName, actorId, ipAddress }) {
    if (!email || !password || !username) {
      const err = new Error("Email, username and password are required");
      err.status = 400;
      throw err;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const manager = await platformRepository.createManagerAccount({
      email: email.toLowerCase().trim(),
      username: username.trim(),
      passwordHash,
      fullName: fullName ? fullName.trim() : null,
      grantedBy: actorId,
    });

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "CREATE_MANAGER",
      targetType: "user",
      targetId: manager.id,
      metadata: { email: manager.email, username: manager.username },
      ipAddress,
    });

    return manager;
  },

  async toggleManagerStatus({ userId, isActive, actorId, ipAddress }) {
    const updated = await platformRepository.toggleManagerStatus(userId, isActive);
    if (!updated) {
      const err = new Error("Manager not found");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: isActive ? "ACTIVATE_MANAGER" : "DEACTIVATE_MANAGER",
      targetType: "platform_admin",
      targetId: userId,
      metadata: { is_active: isActive },
      ipAddress,
    });

    return updated;
  },

  async deleteManager({ userId, actorId, ipAddress }) {
    if (userId === actorId) {
      const err = new Error("Cannot delete your own platform account");
      err.status = 400;
      throw err;
    }

    const deleted = await platformRepository.deleteManager(userId);
    if (!deleted) {
      const err = new Error("Manager not found or cannot be deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "DELETE_MANAGER",
      targetType: "platform_admin",
      targetId: userId,
      ipAddress,
    });

    return { success: true };
  },

  // =========================================================================
  // PLANS
  // =========================================================================

  async listPlans(includeInactive = false) {
    return await platformRepository.listPlans(includeInactive);
  },

  async createPlan(data, { actorId, ipAddress } = {}) {
    if (!data.id || !data.name || data.price_monthly === undefined || data.price_yearly === undefined) {
      const err = new Error("Plan id, name, price_monthly, and price_yearly are required");
      err.status = 400;
      throw err;
    }

    const plan = await platformRepository.createPlan(data);

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "CREATE_SUBSCRIPTION_PLAN",
      targetType: "subscription_plan",
      targetId: plan.id,
      metadata: { name: plan.name, price_monthly: plan.price_monthly },
      ipAddress,
    });

    return plan;
  },

  async updatePlan(id, data, { actorId, ipAddress } = {}) {
    const updated = await platformRepository.updatePlan(id, data);
    if (!updated) {
      const err = new Error("Subscription plan not found");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "UPDATE_SUBSCRIPTION_PLAN",
      targetType: "subscription_plan",
      targetId: id,
      metadata: data,
      ipAddress,
    });

    return updated;
  },

  // =========================================================================
  // SCHOOLS / TENANTS
  // =========================================================================

  async listSchools(filter) {
    return await platformRepository.listSchools(filter);
  },

  async getSchoolDetails(schoolId) {
    const school = await platformRepository.getSchoolById(schoolId);
    if (!school) {
      const err = new Error("School not found");
      err.status = 404;
      throw err;
    }
    return school;
  },

  async createSchool(_input = {}, { actorId, actorRole, ipAddress } = {}) {
    // A manager never supplies a school name or code. The tenant is handed
    // over first; its school_admin supplies profile data during setup.
    const school = await platformRepository.createSchool();

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "CREATE_SCHOOL",
      targetType: "school",
      targetId: school.id,
      metadata: { code: school.code, status: school.status },
      ipAddress,
    });

    return school;
  },

  async lockSchool(schoolId, reason, { actorId, actorRole, ipAddress } = {}) {
    const locked = await platformRepository.lockSchool(schoolId, reason);
    if (!locked) {
      const err = new Error("School not found or already deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "LOCK_SCHOOL",
      targetType: "school",
      targetId: schoolId,
      metadata: { reason },
      ipAddress,
    });

    return locked;
  },

  async unlockSchool(schoolId, { actorId, actorRole, ipAddress } = {}) {
    const unlocked = await platformRepository.unlockSchool(schoolId);
    if (!unlocked) {
      const err = new Error("School not found or already deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "UNLOCK_SCHOOL",
      targetType: "school",
      targetId: schoolId,
      ipAddress,
    });

    return unlocked;
  },

  async suspendSchool(schoolId, reason, { actorId, actorRole, ipAddress } = {}) {
    const suspended = await platformRepository.suspendSchool(schoolId, reason);
    if (!suspended) {
      const err = new Error("School not found or already deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "SUSPEND_SCHOOL",
      targetType: "school",
      targetId: schoolId,
      metadata: { reason },
      ipAddress,
    });

    return suspended;
  },

  async unsuspendSchool(schoolId, { actorId, actorRole, ipAddress } = {}) {
    const unsuspended = await platformRepository.unsuspendSchool(schoolId);
    if (!unsuspended) {
      const err = new Error("School not found or already deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "UNSUSPEND_SCHOOL",
      targetType: "school",
      targetId: schoolId,
      ipAddress,
    });

    return unsuspended;
  },

  async softDeleteSchool(schoolId, { actorId, actorRole, ipAddress } = {}) {
    const deleted = await platformRepository.softDeleteSchool(schoolId);
    if (!deleted) {
      const err = new Error("School not found or already deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "SOFT_DELETE_SCHOOL",
      targetType: "school",
      targetId: schoolId,
      ipAddress,
    });

    return deleted;
  },

  // =========================================================================
  // HANDOVER & INVITATION
  // =========================================================================

  async inviteSchoolAdmin({ schoolId, email }, { actorId, actorRole, ipAddress } = {}) {
    if (!email) {
      const err = new Error("Recipient email is required");
      err.status = 400;
      throw err;
    }

    const school = await platformRepository.getSchoolById(schoolId);
    if (!school) {
      const err = new Error("School not found");
      err.status = 404;
      throw err;
    }

    // Generate random raw token and store its SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await platformRepository.createInvitation({
      schoolId,
      recipientEmail: email,
      tokenHash,
      invitedBy: actorId,
      expiresAt,
    });

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "INVITE_SCHOOL_ADMIN",
      targetType: "school",
      targetId: schoolId,
      metadata: { email, invitationId: invitation.id },
      ipAddress,
    });

    // In local/sandbox development or demo, return the rawToken & invite URL for easy testing
    const inviteUrl = `/onboarding?token=${rawToken}`;
    return {
      invitationId: invitation.id,
      recipientEmail: invitation.recipient_email,
      expiresAt: invitation.expires_at,
      rawToken,
      inviteUrl,
    };
  },

  async verifyInvitation(rawToken) {
    if (!rawToken) {
      const err = new Error("Token is required");
      err.status = 400;
      throw err;
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const invitation = await platformRepository.findInvitationByToken(tokenHash);

    if (!invitation) {
      const err = new Error("Lời mời không hợp lệ hoặc không tồn tại");
      err.status = 404;
      throw err;
    }

    if (invitation.status !== "pending") {
      const err = new Error(`Lời mời này đã ở trạng thái: ${invitation.status}`);
      err.status = 400;
      throw err;
    }

    if (new Date(invitation.expires_at) < new Date()) {
      const err = new Error("Lời mời đã hết hạn");
      err.status = 400;
      throw err;
    }

    return invitation;
  },

  async acceptInvitation({ rawToken, userId }) {
    if (!rawToken) {
      const err = new Error("Token is required");
      err.status = 400;
      throw err;
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const invitation = await platformRepository.acceptInvitation({ tokenHash, userId });

    await platformAuditService.log({
      actorId: userId,
      actorRole: "school_admin",
      action: "ACCEPT_SCHOOL_INVITATION",
      targetType: "school",
      targetId: invitation.school_id,
      metadata: { invitationId: invitation.id },
    });

    return {
      schoolId: invitation.school_id,
      schoolName: invitation.school_name,
      schoolCode: invitation.school_code,
    };
  },

  // =========================================================================
  // CONTRACTS & TRANSACTIONS
  // =========================================================================

  async listContracts(query) {
    return await platformRepository.listContracts(query);
  },

  async listTransactions(query) {
    return await platformRepository.listTransactions(query);
  },

  async getRevenueReports() {
    return await platformRepository.getRevenueReports();
  },

  async listAuditLogs(query) {
    return await platformAuditService.listLogs(query);
  },
};

module.exports = PlatformService;
