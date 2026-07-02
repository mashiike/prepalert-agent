import { describe, test, expect } from "bun:test";
import { createSessionStorage, sessionIdToDatePartition } from "../storage.js";

describe("sessionIdToDatePartition", () => {
  test("extracts date from session ID", () => {
    expect(sessionIdToDatePartition("2026-06-18T14-32-45-123Z-a1b2c3d4")).toBe("2026/06/18");
  });

  test("throws for invalid session ID", () => {
    expect(() => sessionIdToDatePartition("invalid-id")).toThrow("cannot extract date partition");
  });
});

describe("createSessionStorage", () => {
  test("returns null when storageUrl is undefined", () => {
    expect(createSessionStorage(undefined)).toBeNull();
  });

  test("returns null when storageUrl is empty string", () => {
    expect(createSessionStorage("")).toBeNull();
  });

  test("creates S3SessionStorage for s3:// URL", () => {
    const storage = createSessionStorage("s3://my-bucket/sessions/");
    expect(storage).not.toBeNull();
  });

  test("creates S3SessionStorage for gs:// URL", () => {
    const storage = createSessionStorage("gs://my-bucket/sessions/");
    expect(storage).not.toBeNull();
  });

  test("creates S3SessionStorage with storageOptions", () => {
    const storage = createSessionStorage("s3://my-bucket/sessions/", {
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
    });
    expect(storage).not.toBeNull();
  });

  test("throws for invalid URL scheme", () => {
    expect(() => createSessionStorage("http://invalid")).toThrow("invalid storage URL");
  });

  test("parses bucket and prefix from s3:// URL", () => {
    const storage = createSessionStorage("s3://my-bucket/prefix/path/");
    expect(storage).not.toBeNull();
  });

  test("handles s3:// URL without trailing slash", () => {
    const storage = createSessionStorage("s3://my-bucket/prefix");
    expect(storage).not.toBeNull();
  });

  test("handles s3:// URL with just bucket", () => {
    const storage = createSessionStorage("s3://my-bucket");
    expect(storage).not.toBeNull();
  });
});
