"use strict";

const platformService = require("./platform.service");

function actorContext(req) {
  return {
    actorId: req.platformAdmin.userId,
    actorRole: req.platformAdmin.role,
    ipAddress: req.ip,
  };
}

function send(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

const controller = {
  me(req, res) {
    return send(res, {
      userId: req.platformAdmin.userId,
      role: req.platformAdmin.role,
    });
  },

  async listManagers(req, res, next) {
    try { return send(res, await platformService.listManagers()); } catch (error) { return next(error); }
  },

  async createManager(req, res, next) {
    try { return send(res, await platformService.createManager({ ...req.body, ...actorContext(req) }, actorContext(req)), 201); } catch (error) { return next(error); }
  },

  async setManagerStatus(req, res, next) {
    try {
      return send(res, await platformService.toggleManagerStatus({
        userId: req.params.userId,
        isActive: req.body.is_active,
        ...actorContext(req),
      }));
    } catch (error) { return next(error); }
  },

  async listPlans(req, res, next) {
    try { return send(res, await platformService.listPlans(req.query.include_inactive === "true")); } catch (error) { return next(error); }
  },

  async createPlan(req, res, next) {
    try { return send(res, await platformService.createPlan(req.body, actorContext(req)), 201); } catch (error) { return next(error); }
  },

  async updatePlan(req, res, next) {
    try { return send(res, await platformService.updatePlan(req.params.planId, req.body, actorContext(req))); } catch (error) { return next(error); }
  },

  async listSchools(req, res, next) {
    try { return send(res, await platformService.listSchools(req.query)); } catch (error) { return next(error); }
  },

  async createSchool(req, res, next) {
    try { return send(res, await platformService.createSchool(req.body, actorContext(req)), 201); } catch (error) { return next(error); }
  },

  async changeSchoolStatus(req, res, next) {
    try {
      const action = req.params.action || req.path.split("/").filter(Boolean).pop();
      const service = { lock: "lockSchool", unlock: "unlockSchool", suspend: "suspendSchool", restore: "unsuspendSchool", delete: "softDeleteSchool" }[action];
      if (!service) return res.status(404).json({ success: false, message: "Unsupported school action" });
      const args = [req.params.schoolId];
      if (action === "lock" || action === "suspend") args.push(req.body.reason);
      args.push(actorContext(req));
      return send(res, await platformService[service](...args));
    } catch (error) { return next(error); }
  },

  async inviteSchoolAdmin(req, res, next) {
    try { return send(res, await platformService.inviteSchoolAdmin({ schoolId: req.params.schoolId, email: req.body.email }, actorContext(req)), 201); } catch (error) { return next(error); }
  },

  async listContracts(req, res, next) {
    try { return send(res, await platformService.listContracts(req.query)); } catch (error) { return next(error); }
  },

  async listTransactions(req, res, next) {
    try { return send(res, await platformService.listTransactions(req.query)); } catch (error) { return next(error); }
  },

  async revenue(req, res, next) {
    try { return send(res, await platformService.getRevenueReports()); } catch (error) { return next(error); }
  },

  async auditLogs(req, res, next) {
    try { return send(res, await platformService.listAuditLogs(req.query)); } catch (error) { return next(error); }
  },
};

module.exports = controller;
