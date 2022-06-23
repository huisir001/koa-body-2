/*
 * @Description: body数据解析（参考koa-body）
 * @Autor: HuiSir<www.zuifengyun.com>
 * @Date: 2022-06-10 10:16:33
 * @LastEditTime: 2022-06-23 10:24:42
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
]

// 主函数
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
            // json 解析，检查Content-Type类型 ctx.is()
            if (_json && ctx.is(jsonContentTypes)) {
                body = await coBody.json(ctx, {
                    encoding: _encoding,
                    limit: _jsonLimit,
                    strict: _jsonStrict,
                    returnRawBody: false
                })
            }
            // text 解析
            else if (_text && ctx.is('text/*')) {
                body = await coBody.text(ctx, {
                    encoding: _encoding,
                    limit: _textLimit,
                    returnRawBody: false
                })
            }
            // urlencoded 解析
            else if (_urlencoded && ctx.is('urlencoded')) {
                body = await coBody.form(ctx, {
                    encoding: _encoding,
                    limit: _formLimit,
                    returnRawBody: false
                })
            }
            // multipart 解析
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

        // 补丁:node参数存储于ctx.req中，koa存于ctx.request，这里只做patchKoa
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
            maxFileSize: _maxFileSize = 200 * 1024 * 1024, // 200m
            maxFields: _maxFields = 1000,
            maxFieldsSize: _maxFieldsSize = 2 * 1024 * 1024,
            uploadToLocal: _uploadToLocal = true,
            uploadDir: _uploadDir = os.tmpdir(),
            onFileBegin: _onFileBegin
        } = opts

        let raw = {}, files = {}

        // 实例化解析工具
        let form = busboy({
            headers: ctx.req.headers,
            defParamCharset: 'utf8', // 确保汉字param编码正确
            limits: {
                files: !_fileParser ? 0 : _maxFiles,
                fileSize: _maxFileSize,
                fields: _maxFields,
                fieldSize: _maxFieldsSize,
            }
        })

        // 监听处理
        form
            // 普通对象
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
            // 不解析文件
            .on('filesLimit', () => {
                resolve({
                    raw,
                    files
                })
            })
            .on('error', (err) => {
                reject(err)
            })


        // 解析文件
        if (_fileParser) {
            form.on('file', async (fieldName, fileStream, info) => {
                const { filename, mimeType } = info
                const file: bodyParser.File = {
                    name: filename,
                    type: mimeType,
                    lastModified: Date.now(),
                }

                // 文件处理前钩子
                if (_onFileBegin) {
                    if (_uploadToLocal) {
                        _onFileBegin(fieldName, file)
                    } else {
                        _onFileBegin(fieldName, file, fileStream)
                    }
                }

                // 文件流监听
                await fileStreamListener(file, fileStream, _uploadToLocal, _uploadDir).catch((err) => {
                    form.emit('error', err)
                })

                // 补丁
                if (files[fieldName]) {
                    if (Array.isArray(files[fieldName])) {
                        files[fieldName].push(file)
                    } else {
                        files[fieldName] = [files[fieldName], file]
                    }
                } else {
                    files[fieldName] = file
                }

                resolve({
                    raw,
                    files
                })
            })
        }

        // 执行解析
        ctx.req.pipe(form)
    })
}


/**
 * 文件流监听
 */
function fileStreamListener(file: bodyParser.File, fileStream: Readable, uploadToLocal: boolean, uploadDir: string) {
    return new Promise((resolve, reject) => {
        let _size = 0

        // 监听以获取数据size
        fileStream
            // 监听chunk流
            .on('data', (chunk) => {
                _size += chunk.length
            })
            // 监听写入完成
            .on('end', () => {
                // 文件大小计算
                const gb = Number((_size / 1024 / 1024 / 1024).toFixed(2)),
                    mb = Number((_size / 1024 / 1024).toFixed(2)),
                    kb = Number((_size / 1024).toFixed(2));

                file.size = _size
                file.fileSize = gb > 0 ? `${gb} GB` : mb > 0 ? `${mb} MB` : `${kb} KB`
            })

        // 存本地
        if (uploadToLocal) {
            const newName = uuidv4() + path.extname(file.name)
            const data = new Date(), month = data.getMonth() + 1;
            const yyyyMM = data.getFullYear() + (month < 10 ? '0' + month : '' + month)
            const folder = path.join(uploadDir, yyyyMM)
            const filepath = path.join(folder, newName)
            const src = path.join(yyyyMM, newName)

            // 检查文件夹是否存在如果不存在则新建文件夹
            if (!fs.existsSync(folder)) {
                let pathtmp: string
                folder.split(path.sep).forEach((dirname) => {
                    if (pathtmp) {
                        pathtmp = path.join(pathtmp, dirname)
                    } else {
                        //如果在linux系统中，第一个dirname的值为空，所以赋值为"/"
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

            // 创建写入流
            const ws = fs.createWriteStream(filepath)

            // 写入
            fileStream.pipe(ws)
                .on('error', (err) => {
                    reject(err)
                })
                .on('close', () => {
                    resolve(void 0)
                })
                .on('finish', () => {
                    file.newName = newName
                    file.path = filepath
                    file.src = src
                    file.lastModified = Date.now()
                })

            // 报错
            fileStream.on('error', (err) => {
                // 写入流不会主动关闭，需要销毁
                ws.destroy()
                reject(err)
            })

        } else {
            // 监听结束
            fileStream
                .on('close', () => {
                    resolve(void 0)
                })
                .on('error', (err) => {
                    reject(err)
                })
        }
    })
}


/**
 * object
 */
interface IObj extends Object {
    [key: string]: any
}

/**
 * 配置数据类型
 */
export namespace bodyParser {
    export interface File {
        /**
         * 文件名（原始，带后缀）
         */
        name: string

        /**
         * 文件名（重设后，存储名称，带后缀）
         */
        newName?: string

        /**
         * The size of the uploaded file in bytes. If the file is still being uploaded,
         * this property says how many bytes of the file have been written to disk yet.
         */
        size?: number

        /**
         * 带单位的文件大小，保留2位小数，如`100.11 KB`、`100.12 MB`,单位只限KB、MB、GB
         */
        fileSize?: string

        /**
         * 绝对路径（本地存储），非本地存储可为空
         */
        path?: string | null

        /**
         * 相对路径、外链路径
         * 便于数据库存储和前台访问(前端使用，因为path为绝对路径不安全)
         */
        src?: string

        /**
         * The mime type of this file, according to the uploading client.
         */
        type: string | null


        /**
         * A number representing the number of milliseconds between the Unix time epoch and when the file was last modified. \
         * Defaults to a value of Date.now().
         * 最后一次修改时间戳，毫秒数 (文件上传后需要修改文件名再存储，所以取Date.now()为最后修改时间)
         * @default `Date.now()`
         */
        lastModified: number

        // /**
        //  * 文件md5值，作为文件唯一标识
        //  */
        // fileHash?: string

        // /**
        //  * 当前切片号，文件分片上传所需字段，
        //  * 起始为 0
        //  */
        // chunkNumber?: number

        // /**
        //  * 切片总数，文件分片上传所需字段，
        //  * 最小为 1
        //  */
        // chunkCount?: number
    }

    export interface Files {
        [file: string]: File | File[];
    }

    export interface IMultipartOptions {
        /**
        * {Boolean} Parse multipart files, default true
        * 是否解析文件数据，默认true，为 false 时无法解析文件，只处理文件以外的 multipart 参数
        */
        fileParser?: boolean

        /**
         * {Integer} Limits the file number.
         * 限制上传文件数量，默认Infinity（不限数量），
         */
        maxFiles?: number | typeof Infinity

        /**
         * {Integer} Limits the amount of memory all fields together (except files) can allocate in bytes. If this value is exceeded, an 'error' event is emitted. The default size is 20MB.
         * 限制上传文件大小，默认200M，单位bytes，可传`Infinity`（不限大小）
         * @default 200 * 1024 * 1024
         */
        maxFileSize?: number | typeof Infinity

        /**
         * {Integer} Limits the number of fields that the querystring parser will decode, default 1000
         * @default 1000
         */
        maxFields?: number

        /**
         * {Integer} Limits the amount of memory all fields together (except files) can allocate in bytes.
         * If this value is exceeded, an 'error' event is emitted, default 2mb
         * @default 2 * 1024 * 1024
         */
        maxFieldsSize?: number

        /**
         * {Boolean} Save local disk
         * 是否存本地磁盘，默认为true，
         * 若设为false,则文件不会被存储，可在onFileBegin钩子中对文件流进行转存或处理
         * @default true
         */
        uploadToLocal?: boolean

        /**
         * {String} Sets the directory for placing file uploads in，
         * 前提是需要配置`uploadToLocal = true`，默认路径:
         * `[uploadDir]/[date@yyyyMM]/[uuid].ext`
         * 以当前年月分类存储，重命名为uuid,
         * 请使用绝对路径
         * @premise uploadToLocal == true 
         * @default os.tmpdir()
         */
        uploadDir?: string

        /**
         * {Function} Special callback on file begin. The function is executed directly by formidable.
         * 文件处理前钩子函数，当配置uploadToLocal为false时，此钩子传回文件流fileStream，
         * 可使用`fileStream.on('data', (data)=>{}).on('close',()=>{})`监听文件流进行转存，
         * 可在此对file中的参数进行修改,如修改path以存到自定义位置
         */
        onFileBegin?: (fieldName: string, file: File, fileStream?: Readable) => void
    }

    export interface IOptions {
        /**
         * {String|Integer} The byte (if integer) limit of the JSON body, default 1mb
         */
        jsonLimit?: string | number;

        /**
         * {String|Integer} The byte (if integer) limit of the form body, default 56kb
         */
        formLimit?: string | number;

        /**
         * {String|Integer} The byte (if integer) limit of the text body, default 56kb
         */
        textLimit?: string | number;

        /**
         * {String} Sets encoding for incoming form fields, default utf-8
         */
        encoding?: string;

        /**
         * {Boolean} Parse multipart bodies, default false
         * 是否解析multipart数据，默认false，为false时无法得到文件及fields参数
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
         * {Object} Options to pass to the formidable multipart parser
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