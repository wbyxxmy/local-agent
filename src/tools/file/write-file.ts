import { promises as fs } from 'fs';

export const writeFile = async (path: string, content: string) => {
    await fs.writeFile(path, content);
};
