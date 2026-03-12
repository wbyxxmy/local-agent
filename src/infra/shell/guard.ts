export const guard = (condition: boolean) => {
    if (!condition) throw new Error('Guard condition failed');
};
