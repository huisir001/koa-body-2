/*
 * @Description: 
 * @Autor: HuiSir<github.com/huisir001>
 * @Date: 2022-07-28 16:42:08
 * @LastEditTime: 2022-07-28 16:47:45
 */
import Koa from 'koa'
import path from 'node:path'
import koaBody2 from '../index.js'

const app = new Koa();

app.use(koaBody2({
    multipart: true,
    multiOptions: {
        maxFiles: 5, // 多文件上传数量限制
        maxFileSize: 100 * 1024 * 1024, // 文件大小限制 100M
        onFileBegin (ctx, field, file) {
            file.path = path.resolve('C:/my-upload-files')
        }
    }
}));

app.use(ctx => {
    ctx.body = `Request incoming: ${JSON.stringify({
        body: ctx.request.body,
        raw: ctx.request.raw,
        files: ctx.request.files
    })}`;
});

app.listen(8080);