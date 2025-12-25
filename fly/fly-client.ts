import OpenAPIClientAxios from "openapi-client-axios";
import type { Client as FlyClient } from "./fly-machine-apis";
import definitionRaw from "./spec.json" assert { type: "json" };
const definition = JSON.parse(JSON.stringify(definitionRaw));
const api = new OpenAPIClientAxios({ definition });

export const flyClient = await api.init<FlyClient>();
