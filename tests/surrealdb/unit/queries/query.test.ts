import 'jest';
import { v4 as uuidv4 } from 'uuid';

import { cleanup, init } from '../../helpers/lifecycle';
import { deepRemoveMetaData, deepSort, expectArraysInObjectToContainSameElements } from '../../helpers/matchers';
import type { typesSchema } from '../../mocks/generatedSchema';
import type { TypeGen } from '../../../../src/types/typeGen';
import type { WithBormMetadata } from '../../../../src/index';
import type { UserType } from '../../types/testTypes';
import type BormClient from '../../../../src/index';

import 'jest';

// import type BormClient from '../../../../src/index';
// import { cleanup, init } from '../../helpers/lifecycle';

describe('Query', () => {
	let dbName: string;
	let bormClient: BormClient;

	beforeAll(async () => {
		const { dbName: configDbName, bormClient: configBormClient } = await init();

		if (!configBormClient) {
			throw new Error('Failed to initialize BormClient');
		}
		dbName = configDbName;

		bormClient = configBormClient;
	}, 25000);

	// it('v1[validation] - $entity missing', async () => {
	// 	expect(bormClient).toBeDefined();
	// 	// @ts-expect-error - $entity is missing
	// 	await expect(bormClient.query({})).rejects.toThrow();
	// });

	// it('v2[validation] - $entity not in schema', async () => {
	// 	expect(bormClient).toBeDefined();
	// 	await expect(bormClient.query({ $entity: 'fakeEntity' })).rejects.toThrow();
	// });

	it('v3[validation] - $id not existing', async () => {
		expect(bormClient).toBeDefined();
		const res = await bormClient.query({ $entity: 'User', $id: 'nonExisting' });
		await expect(res).toBeNull();
	});

	// it('e1[entity] - basic and direct link to relation', async () => {
	// 	expect(bormClient).toBeDefined();
	// 	const query = { $entity: 'User' };
	// 	const expectedRes = [
	// 		{
	// 			$id: 'god1',
	// 			$thing: 'God',
	// 			$thingType: 'entity',
	// 			email: 'afx@rephlex.com',
	// 			id: 'god1',
	// 			name: 'Richard David James',
	// 		},
	// 		{
	// 			$id: 'superuser1',
	// 			$thing: 'SuperUser',
	// 			$thingType: 'entity',
	// 			email: 'black.mamba@deadly-viper.com',
	// 			id: 'superuser1',
	// 			name: 'Beatrix Kiddo',
	// 		},
	// 		{
	// 			// '$entity': 'User',
	// 			'$thing': 'User',
	// 			'$thingType': 'entity',
	// 			'$id': 'user1',
	// 			'name': 'Antoine',
	// 			'email': 'antoine@test.com',
	// 			'id': 'user1',
	// 			'accounts': ['account1-1', 'account1-2', 'account1-3'],
	// 			'spaces': ['space-1', 'space-2'],
	// 			'user-tags': ['tag-1', 'tag-2'],
	// 		},
	// 		{
	// 			// '$entity': 'User',
	// 			'$thing': 'User',
	// 			'$thingType': 'entity',
	// 			'$id': 'user2',
	// 			'name': 'Loic',
	// 			'email': 'loic@test.com',
	// 			'id': 'user2',
	// 			'accounts': ['account2-1'],
	// 			'spaces': ['space-2'],
	// 			'user-tags': ['tag-3', 'tag-4'],
	// 		},
	// 		{
	// 			// '$entity': 'User',
	// 			'$thing': 'User',
	// 			'$thingType': 'entity',
	// 			'$id': 'user3',
	// 			'name': 'Ann',
	// 			'email': 'ann@test.com',
	// 			'id': 'user3',
	// 			'accounts': ['account3-1'],
	// 			'spaces': ['space-2'],
	// 			'user-tags': ['tag-2'],
	// 		},
	// 		{
	// 			// $entity: 'User',
	// 			$thing: 'User',
	// 			$thingType: 'entity',
	// 			$id: 'user4',
	// 			id: 'user4',
	// 			name: 'Ben',
	// 		},
	// 		{
	// 			// $entity: 'User',
	// 			$thing: 'User',
	// 			$thingType: 'entity',
	// 			$id: 'user5',
	// 			email: 'charlize@test.com',
	// 			id: 'user5',
	// 			name: 'Charlize',
	// 			spaces: ['space-1'],
	// 		},
	// 	];
	// 	const res = await bormClient.query(query);
	// 	expect(res).toBeDefined();
	// 	expect(res).not.toBeInstanceOf(String);
	// 	expect(deepSort(res, 'id')).toEqual(expectedRes);
	// });

	afterAll(async () => {
		await cleanup(bormClient, dbName);
	});
});