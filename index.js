import coBody from 'co-body';
import busboy from 'busboy';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
/**!
 * 可处理 application/x-www-form-urlencoded 和 application/json 以及 multipart/form-data 数据，可配置
 * multipart/form-data中的文件数据默认不存，可配置
 * multipart/form-data中的文件数据可直接存本地，参数补充至ctx.request.files
 * multipart/form-data中文件数据亦可自定义存储，可配置（koa-body不支持自定义，故重写）
 */
// json数据类型
const jsonContentTypes = [
    'application/json',
    'application/json-patch+json',
    'application/vnd.api+json',
    'application/csp-report'
];
// 主函数
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
                body = await coBody.text(ctx, {
                    encoding: _encoding,
                    limit: _textLimit,
                    returnRawBody: false
                });
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
 * 解析form表单数据
 */
function multipartParse(ctx, opts) {
    return new Promise((resolve, reject) => {
        const { fileParser: _fileParser = true, // 是否解析文件
        maxFiles: _maxFiles = Infinity, maxFileSize: _maxFileSize = 200 * 1024 * 1024, // 200m
        maxFields: _maxFields = 1000, maxFieldsSize: _maxFieldsSize = 2 * 1024 * 1024, uploadToLocal: _uploadToLocal = true, uploadDir: _uploadDir = os.tmpdir(), onFileBegin: _onFileBegin } = opts;
        let raw = {}, files = {};
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
            resolve({
                raw,
                files
            });
        })
            .on('error', (err) => {
            reject(err);
        });
        // Parsing file
        if (_fileParser) {
            form.on('file', async (fieldName, fileStream, info) => {
                const { filename, mimeType } = info;
                const file = {
                    name: filename,
                    type: mimeType,
                    lastModified: Date.now(),
                };
                // Hook before file processing
                if (_onFileBegin) {
                    if (_uploadToLocal) {
                        _onFileBegin(fieldName, file);
                    }
                    else {
                        _onFileBegin(fieldName, file, fileStream);
                    }
                }
                // File stream monitoring
                await fileStreamListener(file, fileStream, _uploadToLocal, _uploadDir).catch((err) => {
                    form.emit('error', err);
                });
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
                resolve({
                    raw,
                    files
                });
            });
        }
        // 执行解析
        ctx.req.pipe(form);
    });
}
/**
 * File stream monitoring
 * 文件流监听
 */
function fileStreamListener(file, fileStream, uploadToLocal, uploadDir) {
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
            file.fileSize = gb > 0 ? `${gb} GB` : mb > 0 ? `${mb} MB` : `${kb} KB`;
        });
        // Deposit locally
        if (uploadToLocal) {
            const newName = uuidv4() + path.extname(file.name);
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
        }
        else {
            fileStream
                .on('close', () => {
                resolve(void 0);
            })
                .on('error', (err) => {
                reject(err);
            });
        }
    });
}
export default useBodyParser;
//# sourceMappingURL=index.js.map