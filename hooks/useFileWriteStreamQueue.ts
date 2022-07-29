/*
 * @Description: file write stream open queue 文件流开启队列
 * @Autor: HuiSir<github.com/huisir001>
 * @Date: 2022-07-29 10:44:54
 * @LastEditTime: 2022-07-29 15:38:47
 */
import fs from 'node:fs'

// Avoid the occurrence of `too many open files` error report

export default () => {
    // Closure opens an array queue
    const Queue: fs.WriteStream[] = [], maxLength = 10;
    const createWs = (path: string) => {
        const ws = fs.createWriteStream(path)
        ws.on('close', () => {
            Queue.splice(Queue.findIndex(item => item.path == ws.path), 1)
        })
        Queue.push(ws)
        return ws
    }

    return (path: string, callback: (err: Error | null, ws?: fs.WriteStream) => void) => {
        try {
            // Queue congestion
            if (Queue.length >= maxLength) {
                // Blocking, waiting, judging every 300ms
                const sleepTimer = setInterval(() => {
                    if (Queue.length < maxLength) {
                        callback(null, createWs(path))
                        clearInterval(sleepTimer)
                    }
                }, 300)
            }
            // Number of queues less than maxLength
            else {
                callback(null, createWs(path))
            }
        } catch (error: any) {
            callback(error)
        }
    }
}