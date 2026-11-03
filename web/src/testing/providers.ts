import { Provider } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { FakeIconRegistry } from './icon-registry';

/** Test-environment providers, registered through `providersFile` in angular.json: every spec gets them. */
const providers: Provider[] = [{ provide: MatIconRegistry, useClass: FakeIconRegistry }];

export default providers;
