import coBody from 'co-body';
import busboy from 'busboy';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
/**!
 * `application/x-www-form-urlencoded` and `application/json` and `text/*` data to ctx.request.body.
 * File in `multipart/form-data` can be configured not to parse.
 * FormData other than files in `multipart/form-data` to ctx.request.raw.
 * File in `multipart/form-data` is stored locally by default, and parameters are added to ctx.request.files.
 * File in `multipart/form-data` can also be customized (koa-body does not support customization, so it can be rewritten).
 */
// Json data type
const jsonContentTypes = [
    'application/json',
    'application/json-patch+json',
    'application/vnd.api+json',
    'application/csp-report'
];
// main
const useBodyParser = (opts = {}) => {
    const { onError: _onError, multipart: _multipart = false, urlencoded: _urlencoded = true, json: _json = true, text: _text = true, encoding: _encoding = 'utf-8', jsonLimit: _jsonLimit = '1mb', jsonStrict: _jsonStrict = true, formLimit: _formLimit = '56kb', multiOptions: _multiOptions = {}, textLimit: _textLimit = '56kb' } = opts;
    return async (ctx, next) => {
        let body = {};
        let formData = {};
        const isMuti = _multipart && ctx.is('multipart');
        try {
            // Json parsing, checking Content-Type type ctx.is()
            if (_json && ctx.is(jsonContentTypes)) {
                body = await coBody.json(ctx, {
                    encoding: _encoding,
                    limit: _jsonLimit,
                    strict: _jsonStrict,
                    returnRawBody: false
                });
            }
            // text parsing
            else if (_text && ctx.is('text/*')) {
                const text = await coBody.text(ctx, {
                    encoding: _encoding,
                    limit: _textLimit,
                    returnRawBody: false
                });
                body = { text };
            }
            // urlencoded parsing
            else if (_urlencoded && ctx.is('urlencoded')) {
                body = await coBody.form(ctx, {
                    encoding: _encoding,
                    limit: _formLimit,
                    returnRawBody: false
                });
            }
            // multipart parsing
            else if (isMuti) {
                formData = await multipartParse(ctx, _multiOptions);
            }
        }
        catch (parsingError) {
            if (_onError && typeof _onError === 'function') {
                _onError(parsingError, ctx);
            }
            else {
                throw parsingError;
            }
        }
        // Patch: node parameter is stored in ctx.req, koa is stored in ctx.request, and only patchKoa is done here.
        if (isMuti) {
            ctx.request.raw = formData.raw;
            ctx.request.files = formData.files;
        }
        else {
            ctx.request.body = body;
        }
        await next();
    };
};
/**
 * parse multipart
 * ??????form????????????
 */
function multipartParse(ctx, opts) {
    return new Promise((resolve, reject) => {
        const { fileParser: _fileParser = true, // ??????????????????
        maxFiles: _maxFiles = Infinity, maxFileSize: _maxFileSize = 200 * 1024 * 1024, // 200m
        maxFields: _maxFields = 1000, maxFieldsSize: _maxFieldsSize = 56 * 1024, ifDIY: _ifDIY = false, uploadDir: _uploadDir = os.tmpdir(), onFileBegin: _onFileBegin } = opts;
        let raw = {}, files = {}, hasFile = false, fileParseEnd = false, isClose = false;
        // Instantiation analysis tool
        let form = busboy({
            headers: ctx.req.headers,
            defParamCharset: 'utf8',
            limits: {
                files: !_fileParser ? 0 : _maxFiles,
                fileSize: _maxFileSize,
                fields: _maxFields,
                fieldSize: _maxFieldsSize,
            }
        });
        // Monitoring processing
        form
            // Ordinary object
            .on('field', (fieldName, val, _info) => {
            if (raw[fieldName]) {
                if (Array.isArray(raw[fieldName])) {
                    raw[fieldName].push(val);
                }
                else {
                    raw[fieldName] = [raw[fieldName], val];
                }
            }
            else {
                raw[fieldName] = val;
            }
        })
            // Do not parse the file
            .on('filesLimit', () => {
            resolve({ raw, files });
        })
            // ??????
            .on('close', () => {
            isClose = true;
            if (!hasFile) {
                resolve({ raw, files });
                return;
            }
            if (fileParseEnd) {
                resolve({ raw, files });
            }
        })
            .on('error', (err) => {
            reject(err);
        });
        // Parsing file
        if (_fileParser) {
            form.on('file', async (fieldName, fileStream, info) => {
                hasFile = true;
                // parse ??????
                const { filename, mimeType } = info;
                const file = {
                    name: filename,
                    extName: path.extname(filename),
                    type: mimeType,
                    chunkId: uuidv4(),
                    lastModified: Date.now(),
                };
                // Hook before file processing
                if (_onFileBegin) {
                    if (_ifDIY) {
                        await _onFileBegin(ctx, fieldName, file, fileStream);
                    }
                    else {
                        await _onFileBegin(ctx, fieldName, file);
                    }
                }
                // File stream monitoring
                if (!_ifDIY) {
                    await fileStreamListener(file, fileStream, _uploadDir).catch((err) => {
                        form.emit('error', err);
                    });
                }
                // Patch
                if (files[fieldName]) {
                    if (Array.isArray(files[fieldName])) {
                        files[fieldName].push(file);
                    }
                    else {
                        files[fieldName] = [files[fieldName], file];
                    }
                }
                else {
                    files[fieldName] = file;
                }
                fileParseEnd = true;
                if (isClose) {
                    resolve({ raw, files });
                }
            });
        }
        // ????????????
        ctx.req.pipe(form);
    });
}
/**
 * File stream monitoring
 * ???????????????
 */
function fileStreamListener(file, fileStream, uploadDir) {
    return new Promise((resolve, reject) => {
        let _size = 0;
        // Monitor to get data size
        fileStream
            // Listen for chunk flow
            .on('data', (chunk) => {
            _size += chunk.length;
        })
            // Monitor write complete
            .on('end', () => {
            // File size calculation
            const gb = Number((_size / 1024 / 1024 / 1024).toFixed(2)), mb = Number((_size / 1024 / 1024).toFixed(2)), kb = Number((_size / 1024).toFixed(2));
            file.size = _size;
            file.unitSize = gb > 1 ? `${gb} GB` : mb > 1 ? `${mb} MB` : `${kb} KB`;
        });
        const newName = file.chunkId + file.extName;
        const data = new Date(), month = data.getMonth() + 1;
        const yyyyMM = data.getFullYear() + (month < 10 ? '0' + month : '' + month);
        const folder = path.join(uploadDir, yyyyMM);
        const filepath = path.join(folder, newName);
        const src = path.join(yyyyMM, newName);
        // Check if the folder exists. If not, create a new folder.
        if (!fs.existsSync(folder)) {
            let pathtmp;
            folder.split(path.sep).forEach((dirname) => {
                if (pathtmp) {
                    pathtmp = path.join(pathtmp, dirname);
                }
                else {
                    // If in a linux system, the value of the first dirname is empty, so the value assigned to "/"
                    if (dirname) {
                        pathtmp = dirname;
                    }
                    else {
                        pathtmp = '/';
                    }
                }
                if (!fs.existsSync(pathtmp)) {
                    fs.mkdirSync(pathtmp);
                }
            });
        }
        // Create a write stream
        const ws = fs.createWriteStream(filepath);
        // Write
        fileStream.pipe(ws)
            .on('error', (err) => {
            reject(err);
        })
            .on('close', () => {
            resolve(void 0);
        })
            .on('finish', () => {
            file.newName = newName;
            file.path = filepath;
            file.src = src;
            file.lastModified = Date.now();
        });
        // Error
        fileStream.on('error', (err) => {
            // The write stream will not be actively closed and needs to be destroyed.
            ws.destroy();
            reject(err);
        });
    });
}
export default useBodyParser;
//# sourceMappingURL=index.js.map