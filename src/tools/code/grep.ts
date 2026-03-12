export const grep = (pattern: string, content: string) => {
    const regex = new RegExp(pattern, 'g');
    return content.match(regex);
};
