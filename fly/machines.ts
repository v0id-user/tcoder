import { Hono } from "hono";

const app = new Hono();

app.get('/', async (c) => {
	return c.text('Hello Fly.io Machines!');
});

export default app;
