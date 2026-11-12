export const isCI = process.env.GITHUB_ACTIONS === 'true';

const serverPort = process.env.SERVER_PORT || '8080';

export const basePath = `http://127.0.0.1:${serverPort}/tests/utils/assets/`;

export function getAsset(file: string)
{
    return basePath + file;
}
