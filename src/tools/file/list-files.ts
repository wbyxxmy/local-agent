import { promises as fs } from 'fs';

export const listFiles = async (directory: string) => {
    return await fs.readdir(directory);
};
