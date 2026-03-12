import { exec } from 'child_process';

export const executeCommand = (command: string) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) reject(stderr);
            resolve(stdout);
        });
    });
};
