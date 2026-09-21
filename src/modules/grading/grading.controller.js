const GradingService = require('./grading.service');

const GradingController = {
  // ── UC 37 – Create Grade ─────────────────────────────────────────────────
  async createGrade(req, res, next) {
    try {
      const grade = await GradingService.createGrade(req.body, req.user);
      res.status(201).json({ success: true, data: grade });
    } catch (error) {
      if (error.message === 'SUBMISSION_NOT_FOUND')
        return res.status(404).json({ success: false, message: 'Submission not found' });
      if (error.message === 'GRADE_ALREADY_EXISTS')
        return res.status(409).json({ success: false, message: 'Grade already exists for this submission' });
      if (error.message === 'SCORE_EXCEEDS_MAX')
        return res.status(400).json({ success: false, message: 'Score cannot exceed maxScore' });
      if (error.message === 'FORBIDDEN')
        return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  // ── UC 38 – Update Grade ─────────────────────────────────────────────────
  async updateGrade(req, res, next) {
    try {
      const grade = await GradingService.updateGrade(req.params.id, req.body, req.user);
      if (!grade) {
        return res.status(400).json({ success: false, message: 'No valid fields provided for update' });
      }
      res.status(200).json({ success: true, data: grade });
    } catch (error) {
      if (error.message === 'GRADE_NOT_FOUND')
        return res.status(404).json({ success: false, message: 'Grade not found' });
      if (error.message === 'SCORE_EXCEEDS_MAX')
        return res.status(400).json({ success: false, message: 'Score cannot exceed maxScore' });
      if (error.message === 'FORBIDDEN')
        return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  // ── UC 39 – View Grade ───────────────────────────────────────────────────
  async getGrade(req, res, next) {
    try {
      const grade = await GradingService.getGrade(req.params.id, req.user);
      res.status(200).json({ success: true, data: grade });
    } catch (error) {
      if (error.message === 'GRADE_NOT_FOUND')
        return res.status(404).json({ success: false, message: 'Grade not found' });
      if (error.message === 'FORBIDDEN')
        return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  // ── UC 41 – View Gradebook ───────────────────────────────────────────────
  async getGradebook(req, res, next) {
    try {
      const gradebook = await GradingService.getGradebook(req.params.classId, req.user);
      res.status(200).json({ success: true, data: gradebook });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND')
        return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.message === 'FORBIDDEN')
        return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  // ── UC 42 – Export Gradebook ─────────────────────────────────────────────
  async exportGradebook(req, res, next) {
    try {
      const { classId } = req.params;
      const format = (req.query.format || 'xlsx').toLowerCase();

      if (!['xlsx', 'csv'].includes(format)) {
        return res.status(400).json({ success: false, message: 'format phải là xlsx hoặc csv' });
      }

      const result = await GradingService.exportGradebook(classId, format, req.user);

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="Gradebook_${result.classCode}.csv"`
        );
        return res.status(200).send('\uFEFF' + result.csv); // BOM for Excel UTF-8
      }

      // xlsx
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="Gradebook_${result.classCode}.xlsx"`
      );
      await result.workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND')
        return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.message === 'FORBIDDEN')
        return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },
};

module.exports = GradingController;