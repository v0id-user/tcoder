import { Hono } from 'hono'
import { flyClient } from 'fly/fly-client'
import { env } from 'cloudflare:workers'

const app = new Hono()

app.get('/', (c) => c.text('Hello Cloudflare Workers!'))

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;
