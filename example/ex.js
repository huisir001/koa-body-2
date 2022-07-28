/*
 * @Description: 
 * @Autor: HuiSir<github.com/huisir001>
 * @Date: 2022-07-27 15:14:43
 * @LastEditTime: 2022-07-28 16:44:40
 */
import Koa from 'koa'
import koaBody2 from '../index.js'

const app = new Koa();

app.use(koaBody2({ multipart: true }));

app.use(ctx => {
    ctx.body = `Request incoming: ${JSON.stringify({
        body: ctx.request.body,
        raw: ctx.request.raw,
        files: ctx.request.files
    })}`;
});

app.listen(8080);