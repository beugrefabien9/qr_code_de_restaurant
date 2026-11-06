<?php

use App\Http\Controllers\Api\AdminGeneralController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\ExpenseController;
use App\Http\Controllers\Api\IngredientController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\MenuController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\PublicMenuController;
use App\Http\Controllers\Api\ReservationController;
use App\Http\Controllers\Api\RestaurantController;
use App\Http\Controllers\Api\RestaurantSettingController;
use App\Http\Controllers\Api\StockMovementController;
use App\Http\Controllers\Api\TableController;
use App\Http\Middleware\AuthenticateApiToken;
use App\Http\Middleware\BlockAdminViewOrderSubmission;
use App\Http\Middleware\EnsureGlobalAdmin;
use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => ['status' => 'ok']);

Route::prefix('auth')->group(function () {
    Route::post('/token', [AuthController::class, 'login']);
    Route::post('/register', [AuthController::class, 'register']);
    Route::get('/admin/setup', [AuthController::class, 'adminSetup'])->middleware('throttle:5,1');
    Route::post('/admin/register', [AuthController::class, 'registerAdmin'])->middleware('throttle:5,1');
    Route::post('/token/refresh', [AuthController::class, 'refresh']);
    Route::middleware(AuthenticateApiToken::class)->get('/me', [AuthController::class, 'me']);
});

Route::get('/public/menu/{token}', [PublicMenuController::class, 'menu']);
Route::get('/public/orders/{order}', [PublicMenuController::class, 'orderStatus']);
Route::post('/public/orders', [PublicMenuController::class, 'placeOrder'])->middleware(BlockAdminViewOrderSubmission::class);

Route::middleware(AuthenticateApiToken::class)->group(function () {
    Route::apiResource('restaurants', RestaurantController::class);
    Route::apiResource('menus', MenuController::class);
    Route::apiResource('tables', TableController::class);
    Route::apiResource('categories', CategoryController::class);
    Route::apiResource('products', ProductController::class);
    Route::apiResource('ingredients', IngredientController::class);
    Route::apiResource('stock-movements', StockMovementController::class);
    Route::apiResource('restaurant-settings', RestaurantSettingController::class);
    Route::apiResource('orders', OrderController::class);
    Route::post('/orders/{order}/transition', [OrderController::class, 'transition']);
    Route::apiResource('reservations', ReservationController::class);
    Route::apiResource('payments', PaymentController::class);
    Route::apiResource('expenses', ExpenseController::class);
    Route::apiResource('inventory', InventoryController::class);
});

Route::middleware([AuthenticateApiToken::class, EnsureGlobalAdmin::class])
    ->prefix('admin')
    ->group(function () {
        Route::get('/dashboard', [AdminGeneralController::class, 'dashboard']);
        Route::get('/restaurants', [AdminGeneralController::class, 'restaurants']);
        Route::get('/restaurants/{restaurant}', [AdminGeneralController::class, 'restaurantDetail']);
        Route::patch('/restaurants/{restaurant}', [AdminGeneralController::class, 'updateRestaurant']);
        Route::get('/restaurants/{restaurant}/activity', [AdminGeneralController::class, 'restaurantActivity']);
        Route::get('/restaurants/{restaurant}/view', [AdminGeneralController::class, 'startPartnerView']);
        Route::post('/restaurants/{restaurant}/consult', [AdminGeneralController::class, 'recordPartnerConsultation']);
        Route::patch('/restaurants/{restaurant}/status', [AdminGeneralController::class, 'updateRestaurantStatus']);
        Route::post('/partner-view/close', [AdminGeneralController::class, 'stopPartnerView']);
    });
