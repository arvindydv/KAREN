import { createKarenApiClient } from '@karen/api-contracts/client';
import { publicEnv } from './env';

/** Typed client generated from the API's OpenAPI document. Auth token wiring arrives with sign-in. */
export const api = createKarenApiClient({ baseUrl: publicEnv.NEXT_PUBLIC_API_BASE_URL });
