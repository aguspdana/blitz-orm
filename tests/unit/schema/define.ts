import 'jest';

import { createTest } from '../../helpers/createTest';

export const testSchemaDefine = createTest('Schema', (client) => {
	it('Todo:b1[create] Basic', async () => {
		/*
    todo: Now we can't use the name of the relation if the relation has been extended. 
    */
		expect(client).toBeDefined();

		await client.define();
	});
});