# koa-body-2

=============

> A full-featured [`koa`](https://github.com/koajs/koa) body parser middleware. Supports `multipart`, `urlencoded`, and `json` request bodies. Provides the same functionality as Express's bodyParser - [`multer`](https://github.com/expressjs/multer).         

> Reference from [`koa-body`](https://github.com/koajs/koa-body), Improve the file upload mechanism, support custom storage of files, support unparsed file configuration, and make file upload more flexible.     

## Install
>Install with [npm](https://github.com/npm/npm)     

```
npm install koa-body-2
```

## Features
- can handle requests such as:
  * **multipart/form-data**
  * **application/x-www-form-urlencoded**
  * **application/json**
  * **application/json-patch+json**
  * **application/vnd.api+json**
  * **application/csp-report**
  * **text/xml**
- option for patch to Koa or Node, or either
- file uploads
- body, fields and files size limiting

## Hello World - Quickstart

```sh
npm install koa koa-body-2 # Note that Koa requires Node.js 7.6.0+ for async/await support
```

```js
const Koa = require('koa');
const koaBody2 = require('koa-body-2');
const path = require('node:path');
const os = require('node:os');

const app = new Koa();

// config options
const koaBodyOpts = {
    multipart: true,
    multiOptions:{
        fileParser:true, // if parse file
        uploadToLocal: false, // default true
        // uploadDir: os.tmpdir(),
        onFileBegin(_fieldName, file, fileStream){
            // DIY file save
            let _size = 0
            if(fileStream){

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
                
                const newName = `my_file.${path.extname(file.name)}`
                const filepath = path.join(os.tmpdir(),newName)

                // 创建写入流
                const ws = fs.createWriteStream(filepath)

                // 写入
                fileStream.pipe(ws)
                    .on('error', (err) => {
                        // Handling error messages
                    })
                    .on('close', () => {
                        // close event do something
                    })
                    .on('finish', () => {
                        file.newName = newName
                        file.path = filepath
                        // file.src = 
                        file.lastModified = Date.now()
                    })

                // 报错
                fileStream.on('error', (err) => {
                    // 写入流不会主动关闭，需要销毁
                    ws.destroy()
                    reject(err)
                })
            }
        }
    },
    onError(err, ctx){
        console.error(err)
    }
}

app.use(koaBody2(koaBodyOpts));


app.use(ctx => {
  ctx.body = `Request Body: ${JSON.stringify(ctx.request.body)}`;
});

app.listen(8080);
```