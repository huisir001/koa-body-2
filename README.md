# koa-body-2

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
import Koa from 'koa'
import koaBody2 from 'koa-body-2'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const app = new Koa();

// config options
const koaBodyOpts = {

    multipart: true,

    multiOptions: {

        fileParser: true, // if parse file

        ifDIY: true,

        // uploadDir: os.tmpdir(),

        onFileBegin (ctx, fieldName, file, fileStream) {
            return new Promise((resolve, reject) => {
                // DIY file save

                let _size = 0
                if (fileStream) {

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

                    const newName = file.hash + file.extName

                    const filepath = path.join(os.tmpdir(), newName)

                    // Create a write stream
                    const ws = fs.createWriteStream(filepath)

                    // write
                    fileStream.pipe(ws)
                        .on('error', (err) => {
                            // Handling error messages
                        })
                        .on('close', () => {
                            resolve(void 0)
                        })
                        .on('finish', () => {
                            file.newName = newName
                            file.path = filepath
                            // file.src = 
                            file.lastModified = Date.now()
                        })

                    // fileStream err
                    fileStream.on('error', (err) => {
                        // The write stream will not be actively closed and needs to be destroyed.
                        ws.destroy()
                        reject(err)
                    })
                }
            })
        }
    },
    onError (err, ctx) {
        console.error(err)
    }
}

app.use(koaBody2(koaBodyOpts));


app.use(ctx => {
    ctx.body = `Request incoming: ${JSON.stringify({
        body: ctx.request.body,
        raw: ctx.request.raw,
        files: ctx.request.files
    })}`;
});

app.listen(8080);
```

## Example

```sh
cd example
node ex1.js
```

```sh
node index.js
curl -i http://localhost:3000/users -d "name=test"
```    

Output:
```text
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Content-Length: 29
Date: Wed, 03 May 2017 02:09:44 GMT
Connection: keep-alive

Request incoming: {"body":{"name":"test"}}
```