import type { NextFunction, Request, RequestHandler, Response } from "express";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CHAIN_DISABLED"
  | "CHAIN_ERROR"
  | "ML_UNAVAILABLE"
  | "NOT_ELIGIBLE"
  | "INTERNAL";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message: string, code: ErrorCode = "BAD_REQUEST"): ApiError {
  return new ApiError(400, code, message);
}

export function unauthorized(message = "authentication required"): ApiError {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "insufficient role"): ApiError {
  return new ApiError(403, "FORBIDDEN", message);
}

export function notFound(message = "resource not found"): ApiError {
  return new ApiError(404, "NOT_FOUND", message);
}

export function conflict(message: string, code: ErrorCode = "CONFLICT"): ApiError {
  return new ApiError(409, code, message);
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "invalid JSON body" } });
    return;
  }
  const message = err instanceof Error ? err.message : "unexpected error";
  console.error("[api] unhandled error:", err);
  res.status(500).json({ error: { code: "INTERNAL", message } });
}
