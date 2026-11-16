const ExcelJS = require('exceljs');
const TopicsRepository = require('./topics.repository');
const LearningRepository = require('../learning/learning.repository');

function handleUniqueConstraint(error) {
  if (error && error.code === '23505') {
    const detail = (error.detail || error.message || '').toLowerCase();
    const constraint = (error.constraint || '').toLowerCase();
    if (constraint.includes('name') || detail.includes('name')) {
      const err = new Error('TOPIC_DUPLICATE_NAME');
      err.code = 'TOPIC_DUPLICATE_NAME';
      err.status = 409;
      throw err;
    }
    if (constraint.includes('code') || detail.includes('code')) {
      const err = new Error('TOPIC_DUPLICATE_CODE');
      err.code = 'TOPIC_DUPLICATE_CODE';
      err.status = 409;
      throw err;
    }
    if (constraint.includes('alias') || detail.includes('alias')) {
      const err = new Error('ALIAS_CONFLICT');
      err.code = 'ALIAS_CONFLICT';
      err.status = 409;
      throw err;
    }
  }
  throw error;
}

async function assertSubjectInSchool(subjectId, schoolId = null) {
  let subject = null;
  if (typeof TopicsRepository.findSubject === 'function') {
    subject = await TopicsRepository.findSubject(subjectId, schoolId);
  }
  if (!subject && typeof LearningRepository.findSubjectById === 'function') {
    subject = await LearningRepository.findSubjectById(subjectId, schoolId);
  }
  if (!subject) {
    const error = new Error('SUBJECT_NOT_FOUND');
    error.status = 404;
    throw error;
  }
  return subject;
}

async function assertManageSubject(user, subjectId, schoolId = null) {
  const subject = await assertSubjectInSchool(subjectId, schoolId);
  if (user.role === 'admin' || user.role === 'school_admin') return subject;
  if (
    user.role !== 'lecturer' ||
    !(await TopicsRepository.isLecturerAssignedToSubject(user.id, subjectId, schoolId))
  ) {
    const error = new Error('FORBIDDEN');
    error.status = 403;
    throw error;
  }
  return subject;
}

function assertSchoolAdmin(user) {
  if (user.role !== 'school_admin' && user.role !== 'admin') {
    const error = new Error('FORBIDDEN');
    error.status = 403;
    throw error;
  }
}

const TopicsService = {
  async list(subjectId, query = {}, user, schoolId = null) {
    await assertManageSubject(user, subjectId, schoolId);

    const isSchoolAdmin = user.role === 'school_admin' || user.role === 'admin';
    if (isSchoolAdmin && query.includeAll) {
      return TopicsRepository.listCatalog({
        subjectId,
        schoolId,
        includeAll: true,
        status: query.status,
        reviewRequired: query.reviewRequired,
        isActive: query.isActive,
        search: query.search,
        page: query.page,
        limit: query.limit,
      });
    }

    return TopicsRepository.listBySubject(subjectId, schoolId);
  },

  async getDetail(topicId, user, schoolId = null) {
    assertSchoolAdmin(user);
    const detail = await TopicsRepository.findDetail(topicId, schoolId);
    if (!detail) {
      const error = new Error('TOPIC_NOT_FOUND');
      error.status = 404;
      throw error;
    }
    return detail;
  },

  async create(data, user, schoolId = null) {
    assertSchoolAdmin(user);
    await assertSubjectInSchool(data.subjectId, schoolId);

    if (data.parentId) {
      const error = new Error('INVALID_PARENT_TOPIC');
      error.status = 400;
      throw error;
    }

    const conflictName = await TopicsRepository.findConflictByName(
      schoolId,
      data.subjectId,
      data.name
    );
    if (conflictName) {
      const error = new Error('TOPIC_DUPLICATE_NAME');
      error.status = 409;
      throw error;
    }

    if (data.code && data.code.trim()) {
      const conflictCode = await TopicsRepository.findConflictByCode(
        schoolId,
        data.subjectId,
        data.code
      );
      if (conflictCode) {
        const error = new Error('TOPIC_DUPLICATE_CODE');
        error.status = 409;
        throw error;
      }
    }

    const aliasConflict = await TopicsRepository.checkAliasConflict(
      schoolId,
      data.subjectId,
      data.name
    );
    if (aliasConflict && aliasConflict.type === 'alias') {
      const error = new Error('ALIAS_CONFLICT');
      error.status = 409;
      throw error;
    }

    try {
      return await TopicsRepository.createCanonical({
        schoolId,
        subjectId: data.subjectId,
        name: data.name,
        code: data.code || null,
        description: data.description || '',
        createdBy: user.id,
      });
    } catch (dbError) {
      return handleUniqueConstraint(dbError);
    }
  },

  async generateExcelTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Mau_Import_Topic');

    worksheet.columns = [
      { header: 'Mã Topic (Code)', key: 'code', width: 22 },
      { header: 'Tên Topic (*)', key: 'name', width: 35 },
      { header: 'Mô tả', key: 'description', width: 45 },
      { header: 'Từ đồng nghĩa (phân cách bởi dấu ;)', key: 'aliases', width: 40 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E40AF' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 30;

    worksheet.addRow({
      code: 'PTR_BASIC',
      name: 'Con trỏ cơ bản',
      description: 'Địa chỉ ô nhớ, con trỏ và toán tử dereference * trong C/C++',
      aliases: 'Con trỏ; Pointers; Pointer basics',
    });
    worksheet.addRow({
      code: 'DYNAMIC_MEM',
      name: 'Cấp phát bộ nhớ động',
      description: 'Hàm malloc, calloc, realloc và thu hồi bộ nhớ bằng free',
      aliases: 'Bộ nhớ động; Dynamic memory; Heap',
    });
    worksheet.addRow({
      code: 'STRUCT_UNION',
      name: 'Cấu trúc Struct & Union',
      description: 'Định nghĩa kiểu dữ liệu có cấu trúc và truy xuất trường',
      aliases: 'Struct; Cấu trúc dữ liệu; Union',
    });

    return workbook;
  },

  async parseExcelBuffer(fileBuffer) {
    const workbook = new ExcelJS.Workbook();
    const isZip = fileBuffer.length > 2 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B;
    if (isZip) {
      await workbook.xlsx.load(fileBuffer);
    } else {
      const { Readable } = require('stream');
      await workbook.csv.read(Readable.from([fileBuffer.toString('utf8')]));
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      const err = new Error('EMPTY_WORKBOOK');
      err.status = 400;
      throw err;
    }

    let colMap = { code: 1, name: 2, description: 3, aliases: 4 };
    const headerRow = worksheet.getRow(1);
    if (headerRow) {
      headerRow.eachCell((cell, colNumber) => {
        const val = String(cell.value || '').toLowerCase().trim();
        if (val.includes('mã') || val.includes('code')) colMap.code = colNumber;
        else if (val.includes('tên') || val.includes('name') || val.includes('topic')) colMap.name = colNumber;
        else if (val.includes('mô tả') || val.includes('desc')) colMap.description = colNumber;
        else if (val.includes('đồng nghĩa') || val.includes('alias')) colMap.aliases = colNumber;
      });
    }

    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const getCellText = (colIndex) => {
        const val = row.getCell(colIndex).value;
        if (val === null || val === undefined) return '';
        if (typeof val === 'object' && val.text) return String(val.text).trim();
        return String(val).trim();
      };

      const code = getCellText(colMap.code);
      const name = getCellText(colMap.name);
      const description = getCellText(colMap.description);
      const aliasesRaw = getCellText(colMap.aliases);

      if (!code && !name && !description && !aliasesRaw) return;

      const aliases = aliasesRaw
        ? aliasesRaw
            .split(/[;,]/)
            .map((a) => a.trim())
            .filter(Boolean)
        : [];

      rows.push({
        rowNumber,
        code: code || null,
        name,
        description: description || '',
        aliases,
      });
    });

    if (rows.length === 0) {
      const err = new Error('EMPTY_IMPORT_DATA');
      err.status = 400;
      err.message = 'File không có dữ liệu Topic nào để import';
      throw err;
    }

    return rows;
  },

  async importBatch({ subjectId, topics, preview = false }, user, schoolId = null) {
    assertSchoolAdmin(user);
    await assertSubjectInSchool(subjectId, schoolId);

    if (!Array.isArray(topics) || topics.length === 0) {
      const err = new Error('EMPTY_IMPORT_DATA');
      err.status = 400;
      err.message = 'Danh sách topic import phải có ít nhất 1 dòng';
      throw err;
    }

    const catalog = typeof TopicsRepository.findSubjectTopicCatalog === 'function'
      ? await TopicsRepository.findSubjectTopicCatalog(schoolId, subjectId)
      : { topics: [], aliases: [] };

    const existingNames = new Set((catalog.topics || []).map((t) => t.lower_name));
    const existingCodes = new Set((catalog.topics || []).map((t) => t.lower_code).filter(Boolean));
    const existingAliases = new Set((catalog.aliases || []).map((a) => a.lower_alias));

    const validItems = [];
    const skippedDetails = [];
    const seenNamesInBatch = new Set();
    const seenCodesInBatch = new Set();

    for (let i = 0; i < topics.length; i++) {
      const item = topics[i];
      const rowIdx = item.rowNumber || i + 1;
      const rawName = (item.name || '').trim();
      const rawCode = (item.code || '').trim() || null;
      const lowerName = rawName.toLowerCase();
      const lowerCode = rawCode ? rawCode.toLowerCase() : null;

      if (!rawName) {
        skippedDetails.push({
          row: rowIdx,
          name: rawName,
          code: rawCode,
          reason: 'Tên Topic không được để trống',
        });
        continue;
      }

      if (rawName.length > 255) {
        skippedDetails.push({
          row: rowIdx,
          name: rawName,
          code: rawCode,
          reason: 'Tên Topic vượt quá độ dài tối đa 255 ký tự',
        });
        continue;
      }

      if (rawCode && rawCode.length > 80) {
        skippedDetails.push({
          row: rowIdx,
          name: rawName,
          code: rawCode,
          reason: 'Mã Topic vượt quá độ dài tối đa 80 ký tự',
        });
        continue;
      }

      if (seenNamesInBatch.has(lowerName)) {
        skippedDetails.push({
          row: rowIdx,
          name: rawName,
          code: rawCode,
          reason: 'Tên Topic bị trùng lặp với dòng khác trong danh sách import',
        });
        continue;
      }

      if (lowerCode && seenCodesInBatch.has(lowerCode)) {
        skippedDetails.push({
          row: rowIdx,
          name: rawName,
          code: rawCode,
          reason: 'Mã Topic bị trùng lặp với dòng khác trong danh sách import',
        });
        continue;
      }

      if (existingNames.has(lowerName)) {
        skippedDetails.push({
          row: rowIdx,
          name: rawName,
          code: rawCode,
          reason: 'Tên Topic đã tồn tại trong môn học',
        });
        continue;
      }

      if (lowerCode && existingCodes.has(lowerCode)) {
        skippedDetails.push({
          row: rowIdx,
          name: rawName,
          code: rawCode,
          reason: 'Mã Topic đã tồn tại trong môn học',
        });
        continue;
      }

      if (existingAliases.has(lowerName)) {
        skippedDetails.push({
          row: rowIdx,
          name: rawName,
          code: rawCode,
          reason: 'Tên Topic trùng với từ đồng nghĩa (alias) đã có trong môn học',
        });
        continue;
      }

      const rawAliases = Array.isArray(item.aliases) ? item.aliases : [];
      const cleanAliases = [];
      const seenRowAliases = new Set();

      for (const a of rawAliases) {
        const aliasStr = (a || '').trim();
        const lowerAlias = aliasStr.toLowerCase();
        if (!aliasStr || aliasStr.length > 200) continue;
        if (lowerAlias === lowerName) continue;
        if (seenRowAliases.has(lowerAlias)) continue;
        if (existingAliases.has(lowerAlias) || existingNames.has(lowerAlias)) continue;
        seenRowAliases.add(lowerAlias);
        cleanAliases.push(aliasStr);
      }

      seenNamesInBatch.add(lowerName);
      if (lowerCode) seenCodesInBatch.add(lowerCode);
      for (const a of cleanAliases) {
        existingAliases.add(a.toLowerCase());
      }

      validItems.push({
        row: rowIdx,
        name: rawName,
        code: rawCode,
        description: item.description || '',
        aliases: cleanAliases,
      });
    }

    if (preview) {
      return {
        success: true,
        preview: true,
        total: topics.length,
        validCount: validItems.length,
        invalidCount: skippedDetails.length,
        validItems,
        skippedDetails,
      };
    }

    let importedTopics = [];
    if (validItems.length > 0) {
      importedTopics = await TopicsRepository.createCanonicalBatch({
        schoolId,
        subjectId,
        items: validItems,
        createdBy: user.id,
      });
    }

    return {
      success: true,
      total: topics.length,
      importedCount: importedTopics.length,
      skippedCount: skippedDetails.length,
      importedTopics,
      skippedDetails,
    };
  },

  async importExcelFile(subjectId, fileBuffer, user, schoolId = null, { preview = false } = {}) {
    const rawTopics = await this.parseExcelBuffer(fileBuffer);
    return this.importBatch({ subjectId, topics: rawTopics, preview }, user, schoolId);
  },

  async update(topicId, data, user, schoolId = null) {
    assertSchoolAdmin(user);
    const topic = await TopicsRepository.findById(topicId, schoolId);
    if (!topic) {
      const error = new Error('TOPIC_NOT_FOUND');
      error.status = 404;
      throw error;
    }

    if (data.parentId) {
      const error = new Error('INVALID_PARENT_TOPIC');
      error.status = 400;
      throw error;
    }

    if (data.name && data.name.trim()) {
      const conflictName = await TopicsRepository.findConflictByName(
        schoolId,
        topic.subject_id,
        data.name,
        topicId
      );
      if (conflictName) {
        const error = new Error('TOPIC_DUPLICATE_NAME');
        error.status = 409;
        throw error;
      }
    }

    if (data.code !== undefined && data.code !== null && data.code.trim()) {
      const conflictCode = await TopicsRepository.findConflictByCode(
        schoolId,
        topic.subject_id,
        data.code,
        topicId
      );
      if (conflictCode) {
        const error = new Error('TOPIC_DUPLICATE_CODE');
        error.status = 409;
        throw error;
      }
    }

    try {
      return await TopicsRepository.update(topicId, data, schoolId);
    } catch (dbError) {
      return handleUniqueConstraint(dbError);
    }
  },

  async confirmLegacy(topicId, data, user, schoolId = null) {
    assertSchoolAdmin(user);
    const topic = await TopicsRepository.findById(topicId, schoolId);
    if (!topic) {
      const error = new Error('TOPIC_NOT_FOUND');
      error.status = 404;
      throw error;
    }

    if (data.name && data.name.trim()) {
      const conflictName = await TopicsRepository.findConflictByName(
        schoolId,
        topic.subject_id,
        data.name,
        topicId
      );
      if (conflictName) {
        const error = new Error('TOPIC_DUPLICATE_NAME');
        error.status = 409;
        throw error;
      }
    }

    if (data.code !== undefined && data.code !== null && data.code.trim()) {
      const conflictCode = await TopicsRepository.findConflictByCode(
        schoolId,
        topic.subject_id,
        data.code,
        topicId
      );
      if (conflictCode) {
        const error = new Error('TOPIC_DUPLICATE_CODE');
        error.status = 409;
        throw error;
      }
    }

    try {
      return await TopicsRepository.confirmLegacy(
        topicId,
        {
          code: data.code,
          name: data.name,
          description: data.description,
          reviewNote: data.reviewNote,
          reviewedBy: user.id,
        },
        schoolId
      );
    } catch (dbError) {
      return handleUniqueConstraint(dbError);
    }
  },

  async reviewProposal(topicId, data, user, schoolId = null) {
    assertSchoolAdmin(user);
    const topic = await TopicsRepository.findById(topicId, schoolId);
    if (!topic) {
      const error = new Error('TOPIC_NOT_FOUND');
      error.status = 404;
      throw error;
    }

    if (data.status === 'approved') {
      const targetName =
        data.name !== undefined && data.name !== null && data.name.trim()
          ? data.name.trim()
          : topic.name;

      if (!targetName) {
        const error = new Error('TOPIC_NAME_REQUIRED');
        error.status = 400;
        error.message = 'Tên Topic không được để trống khi phê duyệt';
        throw error;
      }

      // 1. Conflict targetName vs existing topics
      if (targetName.toLowerCase() !== (topic.name || '').toLowerCase()) {
        const conflictName = await TopicsRepository.findConflictByName(
          schoolId,
          topic.subject_id,
          targetName,
          topicId
        );
        if (conflictName) {
          const error = new Error('TOPIC_DUPLICATE_NAME');
          error.status = 409;
          throw error;
        }
      }

      // 2. Conflict targetName vs existing aliases
      const nameAliasConflict = await TopicsRepository.checkAliasConflict(
        schoolId,
        topic.subject_id,
        targetName,
        topicId
      );
      if (nameAliasConflict && nameAliasConflict.type === 'alias') {
        const error = new Error('ALIAS_CONFLICT');
        error.status = 409;
        throw error;
      }

      // Code processing & backward compatibility
      let targetCode =
        data.code !== undefined
          ? data.code && data.code.trim()
            ? data.code.trim()
            : null
          : topic.code || null;

      let targetDesc =
        data.description !== undefined ? data.description : topic.description || '';

      // Backward compatibility: If topic has no code but description starts with "[Mã gợi ý: XXX]"
      if (!targetCode && targetDesc) {
        const match = targetDesc.match(/^\[Mã gợi ý:\s*([^\]]+)\]\s*([\s\S]*)$/);
        if (match) {
          targetCode = match[1].trim();
          targetDesc = match[2].trim();
        }
      }

      // Requirement 1: When Admin approves new Topic, valid topics.code is MANDATORY
      if (!targetCode) {
        const error = new Error('TOPIC_CODE_REQUIRED');
        error.status = 400;
        throw error;
      }

      if (targetCode.length > 80) {
        const error = new Error('TOPIC_CODE_TOO_LONG');
        error.status = 400;
        throw error;
      }

      // 3. Conflict targetCode vs existing topics
      const conflictCode = await TopicsRepository.findConflictByCode(
        schoolId,
        topic.subject_id,
        targetCode,
        topicId
      );
      if (conflictCode) {
        const error = new Error('TOPIC_DUPLICATE_CODE');
        error.status = 409;
        throw error;
      }

      // 4. Conflict targetCode vs existing aliases
      const codeAliasConflict = await TopicsRepository.checkAliasConflict(
        schoolId,
        topic.subject_id,
        targetCode,
        topicId
      );
      if (codeAliasConflict && codeAliasConflict.type === 'alias') {
        const error = new Error('ALIAS_CONFLICT');
        error.status = 409;
        throw error;
      }

      try {
        return await TopicsRepository.reviewProposal(
          topicId,
          {
            status: 'approved',
            code: targetCode,
            name: targetName,
            description: targetDesc,
            reviewNote: data.reviewNote,
            reviewedBy: user.id,
          },
          schoolId
        );
      } catch (dbError) {
        return handleUniqueConstraint(dbError);
      }
    }

    // Rejection flow: marks status = 'rejected' and is_active = false
    return TopicsRepository.reviewProposal(
      topicId,
      {
        status: 'rejected',
        reviewNote: data.reviewNote,
        reviewedBy: user.id,
      },
      schoolId
    );
  },

  async createProposal(data, user, schoolId = null) {
    await assertManageSubject(user, data.subjectId, schoolId);

    // 1. Conflict Name vs existing topics
    const conflictName = await TopicsRepository.findConflictByName(
      schoolId,
      data.subjectId,
      data.name
    );
    if (conflictName) {
      const error = new Error('TOPIC_DUPLICATE_NAME');
      error.status = 409;
      throw error;
    }

    // 2. Conflict Name vs existing aliases
    const nameAliasConflict = await TopicsRepository.checkAliasConflict(
      schoolId,
      data.subjectId,
      data.name
    );
    if (nameAliasConflict && nameAliasConflict.type === 'alias') {
      const error = new Error('ALIAS_CONFLICT');
      error.status = 409;
      throw error;
    }

    // Code is optional on proposal, but if provided, validate conflicts
    if (data.code && data.code.trim()) {
      const trimmedCode = data.code.trim();

      // 3. Conflict Code vs existing topics
      const conflictCode = await TopicsRepository.findConflictByCode(
        schoolId,
        data.subjectId,
        trimmedCode
      );
      if (conflictCode) {
        const error = new Error('TOPIC_DUPLICATE_CODE');
        error.status = 409;
        throw error;
      }

      // 4. Conflict Code vs existing aliases
      const codeAliasConflict = await TopicsRepository.checkAliasConflict(
        schoolId,
        data.subjectId,
        trimmedCode
      );
      if (codeAliasConflict && codeAliasConflict.type === 'alias') {
        const error = new Error('ALIAS_CONFLICT');
        error.status = 409;
        throw error;
      }
    }

    try {
      return await TopicsRepository.createProposal({
        schoolId,
        subjectId: data.subjectId,
        name: data.name,
        code: data.code && data.code.trim() ? data.code.trim() : null,
        description: data.description || '',
        createdBy: user.id,
        reason: data.reason || '',
      });
    } catch (dbError) {
      return handleUniqueConstraint(dbError);
    }
  },

  async setStatus(topicId, isActive, user, schoolId = null) {
    assertSchoolAdmin(user);
    const topic = await TopicsRepository.findById(topicId, schoolId);
    if (!topic) {
      const error = new Error('TOPIC_NOT_FOUND');
      error.status = 404;
      throw error;
    }

    const updated = await TopicsRepository.setStatus(topicId, isActive, schoolId);
    const refs = await TopicsRepository.getReferenceCounts(topicId, schoolId);

    return {
      ...updated,
      references: refs,
    };
  },

  // ─────────────────────────────────────────────
  // ALIAS MANAGEMENT
  // ─────────────────────────────────────────────

  async listAliases(topicId, user, schoolId = null) {
    assertSchoolAdmin(user);
    const topic = await TopicsRepository.findById(topicId, schoolId);
    if (!topic) {
      const error = new Error('TOPIC_NOT_FOUND');
      error.status = 404;
      throw error;
    }
    return TopicsRepository.listAliases(topicId, schoolId);
  },

  async addAlias(topicId, aliasStr, user, schoolId = null) {
    assertSchoolAdmin(user);
    const topic = await TopicsRepository.findById(topicId, schoolId);
    if (!topic) {
      const error = new Error('TOPIC_NOT_FOUND');
      error.status = 404;
      throw error;
    }

    const conflict = await TopicsRepository.checkAliasConflict(
      schoolId,
      topic.subject_id,
      aliasStr,
      topicId
    );
    if (conflict) {
      const error = new Error('ALIAS_CONFLICT');
      error.status = 409;
      error.conflict = conflict;
      throw error;
    }

    try {
      return await TopicsRepository.createAlias({
        topicId,
        schoolId,
        subjectId: topic.subject_id,
        alias: aliasStr,
        createdBy: user.id,
      });
    } catch (dbError) {
      return handleUniqueConstraint(dbError);
    }
  },

  async removeAlias(topicId, aliasId, user, schoolId = null) {
    assertSchoolAdmin(user);
    const topic = await TopicsRepository.findById(topicId, schoolId);
    if (!topic) {
      const error = new Error('TOPIC_NOT_FOUND');
      error.status = 404;
      throw error;
    }

    const deleted = await TopicsRepository.deleteAlias(topicId, aliasId, schoolId);
    if (!deleted) {
      const error = new Error('ALIAS_NOT_FOUND');
      error.status = 404;
      throw error;
    }
    return deleted;
  },

  // ─────────────────────────────────────────────
  // FLASHCARD MANUAL MAPPING (PHASE 2A)
  // ─────────────────────────────────────────────

  async mapFlashcard(topicId, flashcardId, reviewStatus, user, schoolId = null) {
    const topic = await TopicsRepository.findById(topicId, schoolId);
    const card = await TopicsRepository.findFlashcardContext(flashcardId, schoolId);
    if (!topic) throw new Error('TOPIC_NOT_FOUND');
    if (!card || !card.is_active || !card.deck_is_active) throw new Error('FLASHCARD_NOT_FOUND');
    await assertManageSubject(user, topic.subject_id, schoolId);
    if (user.role !== 'admin' && user.role !== 'school_admin' && card.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }
    if (topic.subject_id !== card.subject_id) throw new Error('TOPIC_FLASHCARD_SUBJECT_MISMATCH');
    return TopicsRepository.upsertManualMapping({
      flashcardId,
      topicId,
      reviewStatus,
      mappedBy: user.id,
    });
  },
};

module.exports = TopicsService;
