// CSV upload handling with multer.
// Files are kept in memory only for the duration of the request (no temp files to clean up) and
// are bounded by MAX_UPLOAD_MB. The extension and MIME type are checked here; the content itself
// is checked again in batchIngestionService because extensions can lie.
const path = require('path');
const multer = require('multer');
const { AppError } = require('../utils/AppError');

const ALLOWED_MIME_TYPES = ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'text/x-csv', 'application/octet-stream'];

function createCsvUpload(maxUploadMb) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1, fields: 5, parts: 7 },
    fileFilter: (_req, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      if (extension !== '.csv') {
        return callback(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only .csv files can be uploaded.'));
      }
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return callback(new AppError(415, 'UNSUPPORTED_FILE_TYPE', `File type ${file.mimetype} is not accepted. Upload a CSV file.`));
      }
      return callback(null, true);
    },
  });
  const single = upload.single('file');

  // Converts multer's own errors into clear API errors.
  return (req, res, next) => {
    single(req, res, (error) => {
      if (!error) return next();
      if (error instanceof AppError) return next(error);
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, 'FILE_TOO_LARGE', `The file is larger than the ${maxUploadMb} MB limit.`));
      }
      return next(new AppError(400, 'UPLOAD_INVALID', 'The upload request was not valid. Send one CSV file in the "file" field.'));
    });
  };
}

module.exports = { createCsvUpload };
