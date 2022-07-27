/// <reference types="node" />
import type Koa from 'koa';
import { Readable } from 'node:stream';
/**
 * Koa supplement
 * koa补充
 */
declare module "koa" {
    interface Request extends Koa.BaseRequest {
        body?: IObj;
        raw?: IObj;
        files?: bodyParser.Files;
    }
}
declare const useBodyParser: (opts?: bodyParser.IOptions) => Koa.Middleware<Promise<void>>;
/**
 * object
 */
interface IObj extends Object {
    [key: string]: any;
}
/**
 * Configuration data type
 * 配置数据类型
 */
export declare namespace bodyParser {
    interface File {
        /**
         * File name (original, with extName)
         * 文件名（原始，带文件扩展名）
         */
        name: string;
        /**
         * File extName, example `.exe`、`.xml`
         * 文件扩展名，如`.exe`、`.xml`
         */
        extName: string;
        /**
         * File name (after reset, storage name)
         * 文件名（重设后，存储名称）
         */
        newName?: string;
        /**
         * The size of the uploaded file in bytes. If the file is still being uploaded,
         * this property says how many bytes of the file have been written to disk yet.
         */
        size?: number;
        /**
         * Keep 2 decimal places for file size with units, such as
         * `100.11 KB` and `100.12 MB`. Units are limited to KB, MB and GB.
         * 带单位的文件大小，保留2位小数，如`100.11 KB`、`100.12 MB`,单位只限KB、MB、GB
         */
        unitSize?: string;
        /**
         * Absolute path (local storage), non-local storage can be empty.
         * 绝对路径（本地存储），非本地存储可为空
         */
        path?: string | null;
        /**
         * Relative path, outer chain path.
         * 相对路径、外链路径
         * 便于数据库存储和前台访问(前端使用，因为path为绝对路径不安全)
         */
        src?: string;
        /**
         * The mime type of this file, according to the uploading client.
         */
        type: string | null;
        /**
         * A number representing the number of milliseconds between the Unix time epoch and when the file was last modified.
         * Defaults to a value of Date.now().
         * 最后一次修改时间戳，毫秒数 (文件上传后需要修改文件名再存储，所以取Date.now()为最后修改时间)
         * @default `Date.now()`
         */
        lastModified: number;
        /**
         * Unique ID of the file. (If it is a multipart upload mechanism, the unique ID of the file
         * fragment is used. Uuid is used for assignment here).
         * 文件唯一标识，（若为分片上传机制，则为文件片段唯一标识，这里赋值使用uuid）。
         */
        chunkId: string;
    }
    interface Files {
        [file: string]: File | File[];
    }
    interface IMultipartOptions {
        /**
         * {Boolean} Parse multipart files, default true
         * 是否解析文件数据，默认true，为 false 时无法解析文件，只处理文件以外的 multipart 参数
         * @default true
         */
        fileParser?: boolean;
        /**
         * {Boolean}
         * @default false
         */
        /**
         * {Integer} Limits the file number.
         * 限制上传文件数量，默认Infinity（不限数量），
         */
        maxFiles?: number | typeof Infinity;
        /**
         * {Integer} Limits the amount of memory all fields together (except files) can allocate in bytes. If this value is exceeded, an 'error' event is emitted.
         * 限制上传文件大小，默认`Infinity`（不限大小），单位bytes
         * @default Infinity
         * @example 200 * 1024 * 1024 (200M)
         */
        maxFileSize?: number | typeof Infinity;
        /**
         * {Integer} Limits the number of fields that the querystring parser will decode, default 1000
         * @default 1000
         */
        maxFields?: number;
        /**
         * {Integer} Limits the amount of memory all fields together (except files) can allocate in bytes.
         * If this value is exceeded, an 'error' event is emitted, default 56kb
         * @default 56 * 1024
         */
        maxFieldsSize?: number;
        /**
         * {Boolean} If DIY file processing
         * 是否自定义文件处理，默认为false，文件将会存储至本地磁盘，
         * 若设为true,则文件不会走默认处理脚本，可在onFileBegin钩子中对文件流进行转存或处理，
         * 如存到外部服务器、进行分片上传、断点续传等
         * @default false
         */
        ifDIY?: boolean;
        /**
         * {String} Sets the directory for placing file uploads in，
         * 前提是配置`ifDIY = false`（默认false），默认路径:
         * `[uploadDir]/[date@yyyyMM]/[chunkId].ext`
         * 以当前年月分类存储，重命名为chunkId,
         * 请使用绝对路径
         * @premise ifDIY == false
         * @default os.tmpdir()
         */
        uploadDir?: string;
        /**
         * {Function} Special callback on file begin.
         * 文件处理前钩子函数，当配置`ifDIY = true`时，此钩子传回文件流fileStream，
         * 可使用`fileStream.on('data', (data)=>{}).on('close',()=>{})`监听文件流进行转存，
         * 可在此对file中的参数进行修改,如修改path以存到自定义位置
         */
        onFileBegin?: (ctx: Koa.ParameterizedContext<Promise<void>, Koa.DefaultContext, any>, fieldName: string, file: File, fileStream?: Readable) => void | Promise<any>;
    }
    interface IOptions {
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
export default useBodyParser;
