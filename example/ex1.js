/*
 * @Description: example1
 * @Autor: HuiSir<www.zuifengyun.com>
 * @Date: 2022-06-23 11:14:03
 * @LastEditTime: 2022-07-28 17:51:55
 */
import Koa from 'koa'
import koaBody2 from '../index.js'
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
                            // Transfer error directly delete cache file
                            fs.unlink(tempPath, (err) => {
                                if (err && err.errno != -4058) {
                                    console.error(err)
                                }
                            })
                            reject(err)
                        })
                        .on('close', () => {
                            // Close writeStream
                            ws.destroy()
                        })
                        .on('finish', () => {
                            // Rename and remove temp suffix
                            fs.rename(tempPath, filepath, (err) => {
                                if (err) {
                                    reject(err)
                                } else {
                                    file.newName = newName
                                    file.path = filepath
                                    // file.src = 
                                    file.lastModified = Date.now()
                                    resolve(void 0)
                                }
                            })
                        })

                    // fileStream err
                    fileStream.on('error', (err) => {
                        // The write stream will not be actively closed and needs to be destroyed.
                        ws.destroy()
                        // Transfer error directly delete cache file
                        fs.unlink(tempPath, (err) => {
                            if (err && err.errno != -4058) {
                                console.error(err)
                            }
                        })
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