/* eslint-disable no-param-reassign */
import type { BQLMutationBlock, BormConfig } from '../../../types';
import { clone } from 'radash';

export type TqlRes = any;

export const parseTQLMutation = async (tqlRes: TqlRes, reqThings: any[], reqEdges: any[], config: BormConfig) => {
	// todo: check if something weird happened
	const expected = [...reqThings, ...reqEdges];

	const parsed = expected
		.map((exp) => {
			//! reads all the insertions and gets the first match. This means each id must be unique
			// @ts-expect-error - TODO description
			const currentNode = tqlRes.insertions?.find((y) => y.get(`${exp.$bzId}`))?.get(`${exp.$bzId}`);
			// console.log('current:', JSON.stringify(x));

			if (exp.$op === 'create' || exp.$op === 'update' || exp.$op === 'link') {
				/// Creation and links should show an $error. Update on the other hand might not get here as typeDB does not return deleted thibgs.
				if (!(exp.$op === 'update') && !currentNode && exp.$id) {
					return { $id: exp.$id, $error: "Does not exist or it's not linked to the parent" }; //todo: Return with $error not found?
				}

				const dbIdd = currentNode?.asThing().iid;
				if (config.mutation?.noMetadata) {
					const filteredObject = Object.entries(exp)
						.filter(([k, _]) => !k.startsWith('$')) // Skip keys starting with '$'
						.reduce(
							(acc, [k, v]) => {
								///Relations come with the $bzId in the roles instead of the $ids, lets replace them:
								if (exp.$thingType === 'relation') {
									const matchedThings = expected.filter((x) => x.$id && x.$bzId === v);
									if (matchedThings.length > 1) {
										throw new Error(`Multiple things with the same bzId ${v}`);
									} else if (matchedThings.length === 1) {
										acc[k] = matchedThings[0].$id;
										return acc;
									}
									acc[k] = v;
									return acc;
								}
								acc[k] = v;
								return acc;
							},
							{} as Record<string, any>,
						);
					return filteredObject as BQLMutationBlock;
				}
				/// We revert the cleaning of the tempId
				const tempId = exp.$tempId && !exp.$tempId.startsWith('_:') ? { $tempId: `_:${exp.$tempId}` } : {};
				return { $dbId: dbIdd, ...exp, ...{ [exp.path]: exp.$id, ...tempId } } as BQLMutationBlock;
			}
			if (exp.$op === 'delete' || exp.$op === 'unlink') {
				// todo when typeDB confirms deletions, check them here
				return exp as BQLMutationBlock;
			}
			if (exp.$op === 'match') {
				return undefined;
			}
			throw new Error(`Unsupported op ${exp.$op}`);

			// console.log('config', config);
		})
		.filter((z) => z);

	//console.log('ParseTQLResultNew', result);
	return clone(parsed);
};