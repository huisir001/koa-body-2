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
            // json 解析，检查Content-Type类型 ctx.is()
            if (_json && ctx.is(jsonContentTypes)) {
                body = await coBody.json(ctx, {
                    encoding: _encoding,
                    limit: _jsonLimit,
                    strict: _jsonStrict,
                    returnRawBody: false
                });
            }
            // text 解析
            else if (_text && ctx.is('text/*')) {
                body = await coBody.text(ctx, {
                    encoding: _encoding,
                    limit: _textLimit,
                    returnRawBody: false
                });
            }
            // urlencoded 解析
            else if (_urlencoded && ctx.is('urlencoded')) {
                body = await coBody.form(ctx, {
                    encoding: _encoding,
                    limit: _formLimit,
                    returnRawBody: false
                });
            }
            // multipart 解析
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
        // 补丁:node参数存储于ctx.req中，koa存于ctx.request，这里只做patchKoa
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
        // 实例化解析工具
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
        // 监听处理
        form
            // 普通对象
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
            // 不解析文件
            .on('filesLimit', () => {
            resolve({
                raw,
                files
            });
        })
            .on('error', (err) => {
            reject(err);
        });
        // 解析文件
        if (_fileParser) {
            form.on('file', async (fieldName, fileStream, info) => {
                const { filename, mimeType } = info;
                const file = {
                    name: filename,
                    type: mimeType,
                    lastModified: Date.now(),
                };
                // 文件处理前钩子
                if (_onFileBegin) {
                    if (_uploadToLocal) {
                        _onFileBegin(fieldName, file);
                    }
                    else {
                        _onFileBegin(fieldName, file, fileStream);
                    }
                }
                // 文件流监听
                await fileStreamListener(file, fileStream, _uploadToLocal, _uploadDir).catch((err) => {
                    form.emit('error', err);
                });
                // 补丁
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
 * 文件流监听
 */
function fileStreamListener(file, fileStream, uploadToLocal, uploadDir) {
    return new Promise((resolve, reject) => {
        let _size = 0;
        // 监听以获取数据size
        fileStream
            // 监听chunk流
            .on('data', (chunk) => {
            _size += chunk.length;
        })
            // 监听写入完成
            .on('end', () => {
            // 文件大小计算
            const gb = Number((_size / 1024 / 1024 / 1024).toFixed(2)), mb = Number((_size / 1024 / 1024).toFixed(2)), kb = Number((_size / 1024).toFixed(2));
            file.size = _size;
            file.fileSize = gb > 0 ? `${gb} GB` : mb > 0 ? `${mb} MB` : `${kb} KB`;
        });
        // 存本地
        if (uploadToLocal) {
            const newName = uuidv4() + path.extname(file.name);
            const data = new Date(), month = data.getMonth() + 1;
            const yyyyMM = data.getFullYear() + (month < 10 ? '0' + month : '' + month);
            const folder = path.join(uploadDir, yyyyMM);
            const filepath = path.join(folder, newName);
            const src = path.join(yyyyMM, newName);
            // 检查文件夹是否存在如果不存在则新建文件夹
            if (!fs.existsSync(folder)) {
                let pathtmp;
                folder.split(path.sep).forEach((dirname) => {
                    if (pathtmp) {
                        pathtmp = path.join(pathtmp, dirname);
                    }
                    else {
                        //如果在linux系统中，第一个dirname的值为空，所以赋值为"/"
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
            // 创建写入流
            const ws = fs.createWriteStream(filepath);
            // 写入
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
            // 报错
            fileStream.on('error', (err) => {
                // 写入流不会主动关闭，需要销毁
                ws.destroy();
                reject(err);
            });
        }
        else {
            // 监听结束
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