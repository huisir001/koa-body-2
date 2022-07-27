/*
 * @Description: body数据解析（参考koa-body）
 * @Autor: HuiSir<www.zuifengyun.com>
 * @Date: 2022-06-10 10:16:33
 * @LastEditTime: 2022-07-27 15:34:07
 */
import type Koa from 'koa'
import coBody from 'co-body'
import busboy from 'busboy'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { v4 as uuidv4 } from 'uuid'

/**
 * Koa supplement
 * koa补充
 */
declare module "koa" {
    interface Request extends Koa.BaseRequest {
        body?: IObj // json、text/*、application/x-www-form-urlencoded
        raw?: IObj  // multipart/form-data，不含file
        files?: bodyParser.Files // multipart/form-data
    }
}

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
]

// main
const useBodyParser = (opts: bodyParser.IOptions = {}): Koa.Middleware<Promise<void>> => {
    const {
        onError: _onError,
        multipart: _multipart = false,
        urlencoded: _urlencoded = true,
        json: _json = true,
        text: _text = true,
        encoding: _encoding = 'utf-8',
        jsonLimit: _jsonLimit = '1mb',
        jsonStrict: _jsonStrict = true,
        formLimit: _formLimit = '56kb',
        multiOptions: _multiOptions = {},
        textLimit: _textLimit = '56kb'
    } = opts

    return async (ctx, next) => {
        let body: IObj = {}
        let formData: { raw?: IObj, files?: bodyParser.Files } = {}
        const isMuti = _multipart && ctx.is('multipart')

        try {
            // Json parsing, checking Content-Type type ctx.is()
            if (_json && ctx.is(jsonContentTypes)) {
                body = await coBody.json(ctx, {
                    encoding: _encoding,
                    limit: _jsonLimit,
                    strict: _jsonStrict,
                    returnRawBody: false
                })
            }
            // text parsing
            else if (_text && ctx.is('text/*')) {
                const text = await coBody.text(ctx, {
                    encoding: _encoding,
                    limit: _textLimit,
                    returnRawBody: false
                })
                body = { text }
            }
            // urlencoded parsing
            else if (_urlencoded && ctx.is('urlencoded')) {
                body = await coBody.form(ctx, {
                    encoding: _encoding,
                    limit: _formLimit,
                    returnRawBody: false
                })
            }
            // multipart parsing
            else if (isMuti) {
                formData = await multipartParse(ctx, _multiOptions)
            }

        } catch (parsingError: any) {
            if (_onError && typeof _onError === 'function') {
                _onError(parsingError, ctx)
            } else {
                throw parsingError
            }
        }

        // Patch: node parameter is stored in ctx.req, koa is stored in ctx.request, and only patchKoa is done here.
        if (isMuti) {
            ctx.request.raw = formData.raw
            ctx.request.files = formData.files
        } else {
            ctx.request.body = body
        }

        await next()
    }
}

/**
 * parse multipart
 * 解析form表单数据
 */
function multipartParse(ctx: Koa.ParameterizedContext<Promise<void>, Koa.DefaultContext, any>, opts: bodyParser.IMultipartOptions) {
    return new Promise((resolve, reject) => {
        const {
            fileParser: _fileParser = true, // 是否解析文件
            maxFiles: _maxFiles = Infinity,
            maxFileSize: _maxFileSize = Infinity, // 不限大小
            maxFields: _maxFields = 1000,
            maxFieldsSize: _maxFieldsSize = 56 * 1024,
            ifDIY: _ifDIY = false,
            uploadDir: _uploadDir = os.tmpdir(),
            onFileBegin: _onFileBegin
        } = opts

        let raw = {}, files = {}, expectedFileNum = 0, actualFileNum = 0, isClose = false;

        // Instantiation analysis tool
        let form = busboy({
            headers: ctx.req.headers,
            defParamCharset: 'utf8', // Ensure that the param coding of Chinese characters is correct
            limits: {
                files: !_fileParser ? 0 : _maxFiles,
                fileSize: _maxFileSize,
                fields: _maxFields,
                fieldSize: _maxFieldsSize,
            }
        })

        // Monitoring processing
        form
            // Ordinary object
            .on('field', (fieldName, val, _info) => {
                if (raw[fieldName]) {
                    if (Array.isArray(raw[fieldName])) {
                        raw[fieldName].push(val)
                    } else {
                        raw[fieldName] = [raw[fieldName], val]
                    }
                } else {
                    raw[fieldName] = val
                }
            })
            // Do not parse the file
            .on('filesLimit', () => {
                resolve({ raw, files })
            })
            // 结束
            .on('close', () => {
                isClose = true

                if (expectedFileNum === 0) {
                    resolve({ raw, files })
                    return
                }

                if (expectedFileNum === actualFileNum) {
                    expectedFileNum = 0
                    actualFileNum = 0
                    resolve({ raw, files })
                }

            })
            .on('error', (err) => {
                reject(err)
            })

        // Parsing file
        if (_fileParser) {
            form.on('file', async (fieldName, fileStream, info) => {
                expectedFileNum++
                // parse 解析
                const { filename, mimeType } = info
                const file: bodyParser.File = {
                    name: filename,
                    extName: path.extname(filename),
                    type: mimeType,
                    chunkId: uuidv4(),
                    lastModified: Date.now(),
                }

                // Hook before file processing
                if (_onFileBegin) {
                    if (_ifDIY) {
                        await _onFileBegin(ctx, fieldName, file, fileStream)
                    } else {
                        await _onFileBegin(ctx, fieldName, file)
                    }
                }

                // File stream monitoring
                if (!_ifDIY) {
                    await fileStreamListener(file, fileStream, _uploadDir).catch((err) => {
                        form.emit('error', err)
                    })
                }

                // Patch
                if (files[fieldName]) {
                    if (Array.isArray(files[fieldName])) {
                        files[fieldName].push(file)
                    } else {
                        files[fieldName] = [files[fieldName], file]
                    }
                } else {
                    files[fieldName] = file
                }

                actualFileNum++

                if (isClose && expectedFileNum === actualFileNum) {
                    expectedFileNum = 0
                    actualFileNum = 0
                    resolve({ raw, files })
                }
            })
        }

        // 执行解析
        ctx.req.pipe(form)
    })
}


/**
 * File stream monitoring
 * 文件流监听
 */
function fileStreamListener(file: bodyParser.File, fileStream: Readable, uploadDir: string) {
    return new Promise((resolve, reject) => {
        let _size = 0

        // Monitor to get data size
        fileStream
            // Listen for chunk flow
            .on('data', (chunk) => {
                _size += chunk.length
            })
            // Monitor write complete
            .on('end', () => {
                // File size calculation
                const gb = Number((_size / 1024 / 1024 / 1024).toFixed(2)),
                    mb = Number((_size / 1024 / 1024).toFixed(2)),
                    kb = Number((_size / 1024).toFixed(2));

                file.size = _size
                file.unitSize = gb > 1 ? `${gb} GB` : mb > 1 ? `${mb} MB` : `${kb} KB`
            })

        const newName = file.chunkId + file.extName
        const data = new Date(), month = data.getMonth() + 1
        const yyyyMM = data.getFullYear() + (month < 10 ? '0' + month : '' + month)
        const folder = path.join(uploadDir, yyyyMM)
        const filepath = path.join(folder, newName)
        const src = path.join(yyyyMM, newName)

        // Check if the folder exists. If not, create a new folder.
        if (!fs.existsSync(folder)) {
            let pathtmp: string
            folder.split(path.sep).forEach((dirname) => {
                if (pathtmp) {
                    pathtmp = path.join(pathtmp, dirname)
                } else {
                    // If in a linux system, the value of the first dirname is empty, so the value assigned to "/"
                    if (dirname) {
                        pathtmp = dirname
                    } else {
                        pathtmp = '/'
                    }
                }
                if (!fs.existsSync(pathtmp)) {
                    fs.mkdirSync(pathtmp)
                }
            })
        }

        // Create a write stream
        // To distinguish between complete and incomplete files, 
        // use a new suffix here and wait for the file transfer to complete before renaming.
        const tempPath = filepath + '.temp'
        const ws = fs.createWriteStream(tempPath)

        // Write
        fileStream.pipe(ws)
            .on('error', (err) => {
                reject(err)
            })
            .on('close', () => {
                // Rename and remove temp suffix
                fs.renameSync(tempPath, filepath)
                resolve(void 0)
            })
            .on('finish', () => {
                file.newName = newName
                file.path = filepath
                file.src = src
                file.lastModified = Date.now()
            })

        // Error
        fileStream.on('error', (err) => {
            // The write stream will not be actively closed and needs to be destroyed.
            ws.destroy()
            reject(err)
        })
    })
}


/**
 * object
 */
interface IObj extends Object {
    [key: string]: any
}

/**
 * Configuration data type
 * 配置数据类型
 */
export namespace bodyParser {
    export interface File {
        /**
         * File name (original, with extName)
         * 文件名（原始，带文件扩展名）
         */
        name: string

        /**
         * File extName, example `.exe`、`.xml`
         * 文件扩展名，如`.exe`、`.xml`
         */
        extName: string

        /**
         * File name (after reset, storage name)
         * 文件名（重设后，存储名称）
         */
        newName?: string

        /**
         * The size of the uploaded file in bytes. If the file is still being uploaded,
         * this property says how many bytes of the file have been written to disk yet.
         */
        size?: number

        /**
         * Keep 2 decimal places for file size with units, such as
         * `100.11 KB` and `100.12 MB`. Units are limited to KB, MB and GB.
         * 带单位的文件大小，保留2位小数，如`100.11 KB`、`100.12 MB`,单位只限KB、MB、GB
         */
        unitSize?: string

        /**
         * Absolute path (local storage), non-local storage can be empty.
         * 绝对路径（本地存储），非本地存储可为空
         */
        path?: string | null

        /**
         * Relative path, outer chain path.
         * 相对路径、外链路径
         * 便于数据库存储和前台访问(前端使用，因为path为绝对路径不安全)
         */
        src?: string

        /**
         * The mime type of this file, according to the uploading client.
         */
        type: string | null


        /**
         * A number representing the number of milliseconds between the Unix time epoch and when the file was last modified. 
         * Defaults to a value of Date.now().
         * 最后一次修改时间戳，毫秒数 (文件上传后需要修改文件名再存储，所以取Date.now()为最后修改时间)
         * @default `Date.now()`
         */
        lastModified: number

        /**
         * Unique ID of the file. (If it is a multipart upload mechanism, the unique ID of the file 
         * fragment is used. Uuid is used for assignment here).
         * 文件唯一标识，（若为分片上传机制，则为文件片段唯一标识，这里赋值使用uuid）。
         */
        chunkId: string
    }

    export interface Files {
        [file: string]: File | File[];
    }

    export interface IMultipartOptions {
        /**
         * {Boolean} Parse multipart files, default true
         * 是否解析文件数据，默认true，为 false 时无法解析文件，只处理文件以外的 multipart 参数
         * @default true
         */
        fileParser?: boolean

        /**
         * {Boolean} 
         * @default false
         */


        /**
         * {Integer} Limits the file number.
         * 限制上传文件数量，默认Infinity（不限数量），
         */
        maxFiles?: number | typeof Infinity

        /**
         * {Integer} Limits the amount of memory all fields together (except files) can allocate in bytes. If this value is exceeded, an 'error' event is emitted. 
         * 限制上传文件大小，默认`Infinity`（不限大小），单位bytes
         * @default Infinity
         * @example 200 * 1024 * 1024 (200M)
         */
        maxFileSize?: number | typeof Infinity

        /**
         * {Integer} Limits the number of fields that the querystring parser will decode, default 1000
         * @default 1000
         */
        maxFields?: number

        /**
         * {Integer} Limits the amount of memory all fields together (except files) can allocate in bytes.
         * If this value is exceeded, an 'error' event is emitted, default 56kb
         * @default 56 * 1024
         */
        maxFieldsSize?: number

        /**
         * {Boolean} If DIY file processing 
         * 是否自定义文件处理，默认为false，文件将会存储至本地磁盘，
         * 若设为true,则文件不会走默认处理脚本，可在onFileBegin钩子中对文件流进行转存或处理，
         * 如存到外部服务器、进行分片上传、断点续传等
         * @default false
         */
        ifDIY?: boolean

        /**
         * {String} Sets the directory for placing file uploads in，
         * 前提是配置`ifDIY = false`（默认false），默认路径:
         * `[uploadDir]/[date@yyyyMM]/[chunkId].ext`
         * 以当前年月分类存储，重命名为chunkId,
         * 请使用绝对路径
         * @premise ifDIY == false 
         * @default os.tmpdir()
         */
        uploadDir?: string

        /**
         * {Function} Special callback on file begin.
         * 文件处理前钩子函数，当配置`ifDIY = true`时，此钩子传回文件流fileStream，
         * 可使用`fileStream.on('data', (data)=>{}).on('close',()=>{})`监听文件流进行转存，
         * 可在此对file中的参数进行修改,如修改path以存到自定义位置
         */
        onFileBegin?: (
            ctx: Koa.ParameterizedContext<Promise<void>, Koa.DefaultContext, any>,
            fieldName: string, file: File, fileStream?: Readable
        ) => void | Promise<any>
    }

    export interface IOptions {
        /**
         * {String|Integer} The byte (if integer) limit of the JSON body, default 1mb
         * @default 1mb
         */
        jsonLimit?: string | number;

        /**
         * {String|Integer} The byte (if integer) limit of the form body, default 56kb
         * @default 56kb
         */
        formLimit?: string | number;

        /**
         * {String|Integer} The byte (if integer) limit of the text body, default 56kb
         * @default 56kb
         */
        textLimit?: string | number;

        /**
         * {String} Sets encoding for incoming form fields, default utf-8
         * @default utf-8
         */
        encoding?: string;

        /**
         * {Boolean} Parse multipart bodies, default false
         * 是否解析multipart数据，默认false，为false时无法得到文件及fields参数
         * @default false
         */
        multipart?: boolean;

        /**
         * {Boolean} Parse urlencoded bodies, default true
         * 是否解析urlencoded数据，默认true
         */
        urlencoded?: boolean;

        /**
         * {Boolean} Parse text bodies, default true
         * 是否解析text数据，默认true
         */
        text?: boolean;

        /**
         * {Boolean} Parse json bodies, default true
         * 是否解析json数据，默认true
         */
        json?: boolean;

        /**
         * Toggles co-body strict mode; if true, only parses arrays or objects, default true
         * JSON数据仅支持数组和对象，默认true
         */
        jsonStrict?: boolean;

        /**
         * {Object} Options to pass to the form multipart parser
         * multipart 解析参数，只有在 multipart 设为 true 时有效
         */
        multiOptions?: IMultipartOptions;

        /**
         * {Function} Custom error handle, if throw an error, you can customize the response - onError(error, context), default will throw
         */
        onError?: (err: Error, ctx: Koa.Context) => void;
    }
}

export default useBodyParser