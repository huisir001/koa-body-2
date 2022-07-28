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
 * Detect numeric type
 */
function numberOptTest(opts) {
    opts.forEach(element => {
        if (typeof element[1] !== 'number') {
            throw new Error(`The type of option '${element[0]}' has to be a number!`);
        }
    });
}
/**
 * parse multipart
 * 解析form表单数据
 */
function multipartParse(ctx, opts) {
    return new Promise((resolve, reject) => {
        const { fileParser: _fileParser = true, // 是否解析文件
        maxFiles: _maxFiles = Infinity, maxFileSize: _maxFileSize = Infinity, // 不限大小
        maxFields: _maxFields = 1000, maxFieldsSize: _maxFieldsSize = 56 * 1024, ifDIY: _ifDIY = false, uploadDir: _uploadDir = os.tmpdir(), deleteTimeout: _deleteTimeout = Infinity, // 超时删除，默认不删除
        onFileBegin: _onFileBegin } = opts;
        // 检测数字类型
        numberOptTest([
            ['maxFiles', _maxFiles],
            ['maxFileSize', _maxFileSize],
            ['maxFields', _maxFields],
            ['maxFieldsSize', _maxFieldsSize],
            ['deleteTimeout', _deleteTimeout]
        ]);
        let raw = {}, files = {}, expectedFileNum = 0, actualFileNum = 0, isClose = false;
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
            // 完成
            .on('finish', () => {
            isClose = true;
            if (expectedFileNum === 0) {
                resolve({ raw, files });
                return;
            }
            if (expectedFileNum === actualFileNum) {
                expectedFileNum = 0;
                actualFileNum = 0;
                resolve({ raw, files });
            }
        })
            .on('error', (err) => {
            reject(err);
        });
        // Parsing file
        if (_fileParser) {
            form.on('file', async (fieldName, fileStream, info) => {
                expectedFileNum++;
                // parse 解析
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
                    await fileStreamListener(file, fileStream, _uploadDir, _deleteTimeout).catch((err) => {
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
                actualFileNum++;
                if (isClose && expectedFileNum === actualFileNum) {
                    expectedFileNum = 0;
                    actualFileNum = 0;
                    resolve({ raw, files });
                }
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
function fileStreamListener(file, fileStream, uploadDir, deleteTimeout) {
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
        let newName = file.newName || (file.chunkId + file.extName);
        // If you customize the path property of file in the onFileBegin hook,
        // it can be used to store the path directly.
        // 若在onFileBegin钩子中自定义file的path属性，这里可直接用于存储路径
        let filepath, src;
        if (file.path) {
            filepath = file.path;
            newName = path.basename(file.path);
        }
        else {
            const date = new Date(), month = date.getMonth() + 1;
            const yyyyMM = date.getFullYear() + (month < 10 ? '0' + month : '' + month);
            const folder = path.join(uploadDir, yyyyMM);
            filepath = path.join(folder, newName);
            src = path.join(yyyyMM, newName);
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
        }
        // Create a write stream
        // To distinguish between complete and incomplete files, 
        // use a new suffix here and wait for the file transfer to complete before renaming.
        const tempPath = filepath + '.temp';
        const ws = fs.createWriteStream(tempPath);
        // Timeout deletion
        let deleteTimer = null;
        if (deleteTimeout !== Infinity) {
            deleteTimer = setTimeout(() => {
                // Delete cach
                fs.unlink(tempPath, (err) => {
                    if (err && err.errno != -4058) {
                        console.error(err);
                    }
                });
                // Delete file
                fs.unlink(filepath, (err) => {
                    if (err && err.errno != -4058) {
                        console.error(err);
                    }
                });
                // clear timeout
                clearTimeout(deleteTimer);
                deleteTimer = null;
            }, deleteTimeout);
        }
        // Write
        fileStream.pipe(ws)
            .on('error', (err) => {
            // Transfer error directly delete cache file
            fs.unlink(tempPath, (err) => {
                if (err && err.errno != -4058) {
                    console.error(err);
                }
            });
            // clear timeout
            if (deleteTimer) {
                clearTimeout(deleteTimer);
                deleteTimer = null;
            }
            reject(err);
        })
            .on('close', () => {
            // Close writeStream
            ws.destroy();
        })
            .on('finish', () => {
            // Rename and remove temp suffix
            fs.rename(tempPath, filepath, (err) => {
                if (err) {
                    const rejectErr = err.errno == -4058 || err.errno == -4048
                        ? new Error(`File upload timeout. Please check the value of the module 'koa-body-2' configuration item 'deleteTimeout'.`)
                        : err;
                    reject(rejectErr);
                }
                else {
                    file.newName = newName;
                    file.path = filepath;
                    file.src = file.src || src;
                    file.lastModified = Date.now();
                    resolve(void 0);
                }
            });
        });
        // Error
        fileStream.on('error', (err) => {
            // The write stream will not be actively closed and needs to be destroyed.
            ws.destroy();
            // Transfer error directly delete cache file
            fs.unlink(tempPath, (err) => {
                if (err && err.errno != -4058) {
                    console.error(err);
                }
            });
            // clear timeout
            if (deleteTimer) {
                clearTimeout(deleteTimer);
                deleteTimer = null;
            }
            reject(err);
        });
    });
}
export default useBodyParser;
//# sourceMappingURL=index.js.map