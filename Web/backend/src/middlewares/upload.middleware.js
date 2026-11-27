const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const env = require('../config/env');
const ApiError = require('../utils/apiError');

const root = path.resolve(env.uploadDir);
fs.mkdirSync(root, { recursive: true });

const ALLOWED = /^(application\/pdf|image\/(png|jpe?g|webp)|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel)|text\/csv)$/;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(root, req.tenantId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 8);
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    ALLOWED.test(file.mimetype) ? cb(null, true) : cb(ApiError.badRequest('Only PDF, image, Word, Excel or CSV files are allowed'))
});

module.exports = { upload, uploadRoot: root };
