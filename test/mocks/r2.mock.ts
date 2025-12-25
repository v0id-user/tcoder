/**
 * Mock R2 Bucket for Testing
 *
 * Provides mock implementations of R2Bucket operations
 * for testing R2 event handling and presigned URL functionality.
 */

export interface MockR2Object {
	key: string;
	body?: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob;
	size?: number;
	etag?: string;
	httpEtag?: string;
	uploaded?: Date;
	checksums?: R2Checksums;
	httpMetadata?: R2HTTPMetadata;
	customMetadata?: Record<string, string>;
	version?: string;
}

export interface R2Checksums {
	md5?: ArrayBuffer;
	sha1?: ArrayBuffer;
	sha256?: ArrayBuffer;
	sha384?: ArrayBuffer;
	sha512?: ArrayBuffer;
}

export interface R2HTTPMetadata {
	contentType?: string;
	contentLanguage?: string;
	contentEncoding?: string;
	contentDisposition?: string;
	cacheControl?: string;
	cacheExpiry?: Date;
}

export interface R2ListOptions {
	limit?: number;
	prefix?: string;
	cursor?: string;
	delimiter?: string;
	startAfter?: string;
	include?: ("httpMetadata" | "customMetadata")[];
}

export interface R2ListResult {
	objects: R2Object[];
	truncated: boolean;
	cursor?: string;
	delimitedPrefixes: string[];
}

export interface R2Object {
	key: string;
	version: string;
	size: number;
	etag: string;
	httpEtag: string;
	uploaded: Date;
	httpMetadata?: R2HTTPMetadata;
	customMetadata?: Record<string, string>;
	checksums: R2Checksums;
	range?: R2Range;
}

export interface R2Range {
	offset: number;
	length?: number;
	suffix?: number;
}

/**
 * Mock R2Bucket implementation for testing
 */
export class MockR2Bucket {
	private objects: Map<string, MockR2Object> = new Map();

	async get(key: string): Promise<R2ObjectBody | null> {
		const obj = this.objects.get(key);
		if (!obj) return null;

		let body: ReadableStream;
		if (obj.body) {
			if (typeof obj.body === "string") {
				body = new Blob([obj.body]).stream();
			} else if (obj.body instanceof ArrayBuffer) {
				body = new Blob([obj.body]).stream();
			} else if (ArrayBuffer.isView(obj.body)) {
				body = new Blob([obj.body]).stream();
			} else if (obj.body instanceof Blob) {
				body = obj.body.stream();
			} else {
				body = obj.body;
			}
		} else {
			body = new Blob([]).stream();
		}

		return {
			key: obj.key,
			version: obj.version || "1",
			size: obj.size || 0,
			etag: obj.etag || "mock-etag",
			httpEtag: obj.httpEtag || `"mock-etag"`,
			uploaded: obj.uploaded || new Date(),
			httpMetadata: obj.httpMetadata,
			customMetadata: obj.customMetadata,
			checksums: obj.checksums || {},
			body,
		};
	}

	async head(key: string): Promise<R2Object | null> {
		const obj = this.objects.get(key);
		if (!obj) return null;

		return {
			key: obj.key,
			version: obj.version || "1",
			size: obj.size || 0,
			etag: obj.etag || "mock-etag",
			httpEtag: obj.httpEtag || `"mock-etag"`,
			uploaded: obj.uploaded || new Date(),
			httpMetadata: obj.httpMetadata,
			customMetadata: obj.customMetadata,
			checksums: obj.checksums || {},
		};
	}

	async put(
		key: string,
		value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
		options?: R2PutOptions,
	): Promise<R2Object> {
		const obj: MockR2Object = {
			key,
			body: value || undefined,
			size: value instanceof Blob ? value.size : typeof value === "string" ? value.length : undefined,
			httpMetadata: options?.httpMetadata,
			customMetadata: options?.customMetadata,
			uploaded: new Date(),
			etag: `etag-${Date.now()}`,
			httpEtag: `"etag-${Date.now()}"`,
		};

		this.objects.set(key, obj);

		return {
			key,
			version: "1",
			size: obj.size || 0,
			etag: obj.etag || "mock-etag",
			httpEtag: obj.httpEtag || `"mock-etag"`,
			uploaded: obj.uploaded || new Date(),
			httpMetadata: obj.httpMetadata,
			customMetadata: obj.customMetadata,
			checksums: {},
		};
	}

	async delete(keys: string | string[]): Promise<void> {
		const keysArray = Array.isArray(keys) ? keys : [keys];
		for (const key of keysArray) {
			this.objects.delete(key);
		}
	}

	list(options?: R2ListOptions): Promise<R2ListResult> {
		const prefix = options?.prefix || "";
		const limit = options?.limit || 1000;

		const matchingKeys = Array.from(this.objects.keys())
			.filter((key) => key.startsWith(prefix))
			.slice(0, limit);

		const objects = matchingKeys
			.map((key) => {
				const obj = this.objects.get(key);
				if (!obj) return null;
				return {
					key: obj.key,
					version: obj.version || "1",
					size: obj.size || 0,
					etag: obj.etag || "mock-etag",
					httpEtag: obj.httpEtag || `"mock-etag"`,
					uploaded: obj.uploaded || new Date(),
					httpMetadata: obj.httpMetadata,
					customMetadata: obj.customMetadata,
					checksums: obj.checksums || {},
				};
			})
			.filter((obj): obj is NonNullable<typeof obj> => obj !== null);

		return Promise.resolve({
			objects,
			truncated: matchingKeys.length >= limit,
			cursor: undefined,
			delimitedPrefixes: [],
		});
	}

	has(key: string): boolean {
		return this.objects.has(key);
	}

	reset(): void {
		this.objects.clear();
	}
}

export interface R2PutOptions {
	httpMetadata?: R2HTTPMetadata;
	customMetadata?: Record<string, string>;
	onlyIf?: R2Conditional;
}

export interface R2Conditional {
	etagMatches?: string;
	etagDoesNotMatch?: string;
	uploadedBefore?: Date;
	uploadedAfter?: Date;
}

export interface R2ObjectBody extends R2Object {
	body: ReadableStream;
}
