import { Routes } from '@angular/router';

import { authGuard } from '../../core/identity/auth-guard';
import { SendSmsPage } from './send/send-sms-page';

/**
 * Mounted on `send-sms` by `app.routes.ts`, so the path here is empty. It cannot mount on the empty
 * path itself: the identity feature already occupies that, and a second empty-path `loadChildren`
 * sibling would be ambiguous.
 *
 * The guard sits on the route rather than on the parent, matching `identity.routes.ts`. It is
 * `canActivate`, so the chunk is fetched before the redirect happens — `canMatch` would spare a
 * signed-out visitor the download, but one pattern for guarding a feature is worth more here than
 * one saved request on a page nobody unauthenticated is aiming for.
 */
export const smsRoutes: Routes = [
  {
    path: '',
    component: SendSmsPage,
    title: 'Send an SMS · nmk',
    canActivate: [authGuard],
  },
];
