/* eslint-disable no-param-reassign */
import { clone, isArray } from 'radash';
import type { BormConfig, EnrichedBormSchema, EnrichedBQLMutationBlock, TransFormAction } from '../../../../types';
import { deepCurrent, getSymbols, isBQLBlock } from '../../../../helpers';
import { getTriggeredActions } from '../shared/getTriggeredActions';
import { DBNode, IsTransformed } from '../../../../types/symbols';

export const preHookTransformations = (
	node: EnrichedBQLMutationBlock,
	field: string,
	schema: EnrichedBormSchema,
	config: BormConfig,
) => {
	const newNodes = (isArray(node[field]) ? node[field] : [node[field]]).map((subNode: EnrichedBQLMutationBlock) => {
		// Step 1: Default node attributes

		// Step 2: Transform nodes
		if (isBQLBlock(subNode)) {
			// @ts-expect-error todo
			if (subNode.$fields || subNode[IsTransformed]) {
				///change machine context so we are sun we run preQueryDeps before coming back to here
				return subNode;
			}

			const triggeredActions = getTriggeredActions(subNode, schema).filter(
				(action) => action.type === 'transform',
			) as TransFormAction[];

			const parentNode = clone(deepCurrent(node)) as EnrichedBQLMutationBlock;
			const currentNode = clone(deepCurrent(subNode)) as EnrichedBQLMutationBlock;
			const userContext = (config.mutation?.context || {}) as Record<string, any>;
			const dbNode = clone(
				deepCurrent<EnrichedBQLMutationBlock | Record<string, never>>(subNode[DBNode] || subNode.$dbNode),
			) as EnrichedBQLMutationBlock | Record<string, never>;

			triggeredActions.forEach((action) => {
				//! Todo: Sandbox the function in computeFunction()
				const newProps = action.fn(currentNode, parentNode, userContext, dbNode || {});
				if (Object.keys(newProps).length === 0) {
					return;
				}
				// eslint-disable-next-line no-param-reassign
				subNode = { ...currentNode, ...newProps, ...getSymbols(subNode), [IsTransformed]: true };
			});

			return subNode;
		}
		//#endregion nested nodes
	});

	node[field] = isArray(node[field]) ? newNodes : newNodes[0];
};
