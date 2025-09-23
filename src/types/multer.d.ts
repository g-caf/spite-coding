import { Request } from 'express';

declare global {
  namespace Express {
    namespace Multer {
      interface File {
        hash?: string;
        key?: string;
      }
    }
    
    interface Request {
      files?: Multer.File[] | { [fieldname: string]: Multer.File[] };
      file?: Multer.File;
    }
  }
}

export {};