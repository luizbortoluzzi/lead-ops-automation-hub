import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './auth.constants';

/** Marks a route (or controller) as public — the API-key guard lets it through. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
