/**
 * Shared test controllers for versioning tests.
 *
 * These controllers are used across multiple versioning test files
 * to maintain consistency and reduce duplication.
 */
import {
  Controller,
  Get,
  Post,
  VERSION_NEUTRAL,
  Version,
} from '@nestjs/common'

// ================================
// URI Versioning Controllers
// ================================

@Controller({
  path: 'cats',
  version: '1',
})
export class CatsControllerV1 {
  @Get()
  findAll() {
    return { version: '1', message: 'All cats from version 1' }
  }

  @Get('details')
  getDetails() {
    return { version: '1', details: 'Cat details from v1' }
  }

  @Post()
  create() {
    return { version: '1', created: true }
  }
}

@Controller({
  path: 'cats',
  version: '2',
})
export class CatsControllerV2 {
  @Get()
  findAll() {
    return { version: '2', message: 'All cats from version 2' }
  }

  @Get('details')
  getDetails() {
    return { version: '2', details: 'Cat details from v2 with more info' }
  }

  @Post()
  create() {
    return { version: '2', created: true, enhanced: true }
  }
}

@Controller({
  path: 'cats',
  version: '3',
})
export class CatsControllerV3 {
  @Get()
  findAll() {
    return { version: '3', message: 'All cats from version 3', pagination: true }
  }
}

// Controller with multiple versions
@Controller({
  path: 'dogs',
  version: ['1', '2'],
})
export class DogsControllerV1V2 {
  @Get()
  findAll() {
    return { version: '1 or 2', message: 'All dogs from version 1 or 2' }
  }
}

@Controller({
  path: 'dogs',
  version: '3',
})
export class DogsControllerV3 {
  @Get()
  findAll() {
    return { version: '3', message: 'All dogs from version 3' }
  }
}

// Version neutral controller
@Controller({
  path: 'health',
  version: VERSION_NEUTRAL,
})
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', version: 'neutral' }
  }
}

// Controller with route-level versioning
@Controller('birds')
export class BirdsController {
  @Version('1')
  @Get()
  findAllV1() {
    return { version: '1', message: 'Birds from version 1' }
  }

  @Version('2')
  @Get()
  findAllV2() {
    return { version: '2', message: 'Birds from version 2' }
  }

  @Version(['1', '2', '3'])
  @Get('multi')
  findMulti() {
    return { version: '1, 2, or 3', message: 'Birds multi-version route' }
  }

  @Version(VERSION_NEUTRAL)
  @Get('neutral')
  findNeutral() {
    return { version: 'neutral', message: 'Birds neutral version route' }
  }
}

// Controller mixing controller and route level versioning
@Controller({
  path: 'fish',
  version: '1',
})
export class FishController {
  @Get()
  findAll() {
    return { version: '1', message: 'Fish from controller version 1' }
  }

  @Version('2')
  @Get('special')
  findSpecialV2() {
    return { version: '2', message: 'Fish special route overridden to v2' }
  }

  @Version(VERSION_NEUTRAL)
  @Get('common')
  findCommon() {
    return { version: 'neutral', message: 'Fish common route version neutral' }
  }
}

// ================================
// Header Versioning Controllers
// ================================

@Controller({
  path: 'products',
  version: '1',
})
export class ProductsControllerV1 {
  @Get()
  findAll() {
    return { version: '1', products: ['Product A', 'Product B'] }
  }
}

@Controller({
  path: 'products',
  version: '2',
})
export class ProductsControllerV2 {
  @Get()
  findAll() {
    return { version: '2', products: ['Product A v2', 'Product B v2', 'Product C v2'] }
  }
}

@Controller({
  path: 'products',
  version: VERSION_NEUTRAL,
})
export class ProductsControllerNeutral {
  @Get('status')
  getStatus() {
    return { status: 'available', version: 'neutral' }
  }
}

// ================================
// Media Type Versioning Controllers
// ================================

@Controller({
  path: 'orders',
  version: '1',
})
export class OrdersControllerV1 {
  @Get()
  findAll() {
    return { version: '1', orders: [{ id: 1, item: 'Widget' }] }
  }
}

@Controller({
  path: 'orders',
  version: '2',
})
export class OrdersControllerV2 {
  @Get()
  findAll() {
    return {
      version: '2',
      orders: [{ id: 1, item: 'Widget', quantity: 5, price: 9.99 }],
      metadata: { total: 1 },
    }
  }
}

// ================================
// Default Version Controllers
// ================================

@Controller('items')
export class ItemsController {
  @Get()
  findAll() {
    return { message: 'Items without explicit version' }
  }
}

@Controller({
  path: 'items',
  version: '2',
})
export class ItemsControllerV2 {
  @Get()
  findAll() {
    return { version: '2', message: 'Items from version 2' }
  }
}

// ================================
// Custom Versioning Controllers
// ================================

@Controller({
  path: 'custom',
  version: '1.0.0',
})
export class CustomControllerV1 {
  @Get()
  findAll() {
    return { version: '1.0.0', message: 'Custom versioning v1.0.0' }
  }
}

@Controller({
  path: 'custom',
  version: '2.0.0',
})
export class CustomControllerV2 {
  @Get()
  findAll() {
    return { version: '2.0.0', message: 'Custom versioning v2.0.0' }
  }
}

@Controller({
  path: 'custom',
  version: '2.1.0',
})
// eslint-disable-next-line sonarjs/class-name
export class CustomControllerV2_1 {
  @Get()
  findAll() {
    return { version: '2.1.0', message: 'Custom versioning v2.1.0' }
  }
}
